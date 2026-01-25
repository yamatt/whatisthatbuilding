package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"runtime"
	"strconv"
	"strings"

	_ "github.com/mattn/go-sqlite3"
	"github.com/qedus/osmpbf"
	"github.com/spf13/cobra"
)

type Meta struct {
	Name    string
	Height  float64
	Levels  int
	Address string
}

func main() {
	var workers int
	var cmd = &cobra.Command{
		Use:   "tall-extractor <pbf-file> <output-db>",
		Short: "Extract tall buildings and peaks from OSM PBF files",
		Args:  cobra.ExactArgs(2),
		Run: func(cmd *cobra.Command, args []string) {
			pbfPath := args[0]
			dbPath := args[1]
			extractBuildings(pbfPath, dbPath, workers)
		},
	}
	cmd.Flags().IntVar(&workers, "workers", 0, "Number of CPU workers to use (0 = auto-detect)")
	if err := cmd.Execute(); err != nil {
		log.Fatalf("command execution failed: %v", err)
	}
}

func extractBuildings(pbfPath string, dbPath string, workers int) {
	// 1. Initialize SQLite with SpatiaLite
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer func() {
		if err := db.Close(); err != nil {
			log.Printf("error closing database: %v", err)
		}
	}()

	setupDatabase(db)

	// Determine number of workers
	if workers <= 0 {
		workers = runtime.NumCPU()
	}
	fmt.Printf("Using %d CPU workers for decoding...\n", workers)

	// watchlist stores NodeID -> Metadata for Pass 2
	watchlist := make(map[int64]Meta)

	// --- PASS 1: Identify Ways (Buildings) ---
	fmt.Println("Starting Pass 1: Scanning for tall buildings...")
	f, _ := os.Open(pbfPath)
	d := osmpbf.NewDecoder(f)
	if err := d.Start(workers); err != nil {
		log.Fatalf("failed to start decoder: %v", err)
	}

	for {
		v, err := d.Decode()
		if err != nil {
			break
		}

		switch o := v.(type) {
		case *osmpbf.Way:
			levels, _ := strconv.Atoi(o.Tags["building:levels"])
			height := parseHeight(o.Tags["height"])

			if o.Tags["building"] != "" && (levels > 5 || height > 30) {
				if len(o.NodeIDs) > 0 {
					// Extract Address
					addrParts := []string{
						o.Tags["addr:housenumber"],
						o.Tags["addr:street"],
						o.Tags["addr:city"],
					}
					fullAddr := strings.TrimSpace(strings.Join(addrParts, " "))

					watchlist[o.NodeIDs[0]] = Meta{
						Name:    o.Tags["name"],
						Height:  height,
						Levels:  levels,
						Address: fullAddr,
					}
				}
			}
		}
	}
	if err := f.Close(); err != nil {
		log.Printf("error closing file: %v", err)
	}
	fmt.Printf("Found %d tall buildings.\n", len(watchlist))

	// --- PASS 2: Collect Coordinates (Nodes & Peaks) ---
	fmt.Println("Starting Pass 2: Extracting locations...")
	f, _ = os.Open(pbfPath)
	d = osmpbf.NewDecoder(f)
	if err := d.Start(workers); err != nil {
		log.Fatalf("failed to start decoder: %v", err)
	}

	tx, err := db.Begin()
	if err != nil {
		log.Fatalf("Failed to start transaction: %v", err)
	}
	stmt, err := tx.Prepare("INSERT INTO features (name, type, height, levels, address, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		log.Fatalf("Failed to prepare statement: %v", err)
	}

	insertCount := 0
	const batchSize = 1000

	for {
		v, err := d.Decode()
		if err != nil {
			break
		}

		switch o := v.(type) {
		case *osmpbf.Node:
			// Case A: It's a Peak
			if o.Tags["natural"] == "peak" {
				_, err := stmt.Exec(o.Tags["name"], "peak", parseHeight(o.Tags["ele"]), 0, "", o.Lat, o.Lon)
				if err != nil {
					log.Printf("Error inserting peak: %v", err)
				}
				insertCount++
			}

			// Case B: It's a Mast or Tower
			if o.Tags["man_made"] == "mast" || o.Tags["man_made"] == "tower" {
				_, err := stmt.Exec(o.Tags["name"], o.Tags["man_made"], parseHeight(o.Tags["height"]), 0, "", o.Lat, o.Lon)
				if err != nil {
					log.Printf("Error inserting mast/tower: %v", err)
				}
				insertCount++
			}

			// Case C: It's the first node of a tall building
			if meta, ok := watchlist[o.ID]; ok {
				_, err := stmt.Exec(meta.Name, "building", meta.Height, meta.Levels, meta.Address, o.Lat, o.Lon)
				if err != nil {
					log.Printf("Error inserting building: %v", err)
				}
				insertCount++
			}

			// Periodic commits for batching
			if insertCount%batchSize == 0 && insertCount > 0 {
				if err := stmt.Close(); err != nil {
					log.Printf("error closing statement: %v", err)
				}
				if err := tx.Commit(); err != nil {
					log.Printf("error committing transaction: %v", err)
				}
				tx, err = db.Begin()
				if err != nil {
					log.Fatalf("Failed to start transaction: %v", err)
				}
				stmt, err = tx.Prepare("INSERT INTO features (name, type, height, levels, address, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)")
				if err != nil {
					log.Fatalf("Failed to prepare statement: %v", err)
				}
			}
		}
	}
	if err := stmt.Close(); err != nil {
		log.Printf("error closing statement: %v", err)
	}
	if err := tx.Commit(); err != nil {
		log.Printf("error committing transaction: %v", err)
	}
	if err := f.Close(); err != nil {
		log.Printf("error closing file: %v", err)
	}
	fmt.Printf("Inserted %d features.\n", insertCount)

	// Checkpoint WAL and clean up temporary files
	fmt.Println("Consolidating database...")
	if _, err := db.Exec("PRAGMA wal_checkpoint(TRUNCATE);"); err != nil {
		log.Printf("error during wal checkpoint: %v", err)
	}
	if _, err := db.Exec("VACUUM;"); err != nil {
		log.Printf("error during vacuum: %v", err)
	}

	fmt.Println("Done! Saved to", dbPath)
}

func setupDatabase(db *sql.DB) {
	commands := []string{
		"PRAGMA journal_mode=WAL;",
		`CREATE TABLE IF NOT EXISTS features (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT,
			type TEXT,
			height REAL,
			levels INTEGER,
			address TEXT,
			latitude REAL,
			longitude REAL
		);`,
		"CREATE INDEX IF NOT EXISTS idx_features_lat_lon ON features(latitude, longitude);",
		"CREATE INDEX IF NOT EXISTS idx_features_type ON features(type);",
	}
	for _, cmd := range commands {
		_, err := db.Exec(cmd)
		if err != nil {
			log.Printf("Error executing command: %v", err)
		}
	}
}

func parseHeight(h string) float64 {
	if h == "" {
		return 0
	}
	// Basic cleanup for units like '30 m' or '100 ft'
	h = strings.Fields(h)[0]
	h = strings.TrimSuffix(h, "m")
	val, _ := strconv.ParseFloat(h, 64)
	return val
}
