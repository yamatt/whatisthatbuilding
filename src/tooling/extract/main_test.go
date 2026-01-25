package main

import (
	"database/sql"
	"os"
	"testing"
)

func TestParseHeight(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected float64
	}{
		{"empty string", "", 0.0},
		{"simple meters", "30", 30.0},
		{"meters with unit", "30 m", 30.0},
		{"meters with suffix", "30m", 30.0},
		{"decimal value", "45.5", 45.5},
		{"decimal with unit", "45.5 m", 45.5},
		{"large value", "310.0", 310.0},
		{"invalid value", "invalid", 0.0},
		{"mixed content", "100 meters tall", 100.0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseHeight(tt.input)
			if result != tt.expected {
				t.Errorf("parseHeight(%q) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}

func TestSetupDatabase(t *testing.T) {
	tmpDB := "test_temp.db"
	defer os.Remove(tmpDB)

	db, err := sql.Open("sqlite3", tmpDB)
	if err != nil {
		t.Fatalf("Failed to open test database: %v", err)
	}
	defer db.Close()

	setupDatabase(db)

	var tableName string
	err = db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='features'").Scan(&tableName)
	if err != nil {
		t.Errorf("Table 'features' was not created: %v", err)
	}

	rows, err := db.Query("PRAGMA table_info(features)")
	if err != nil {
		t.Fatalf("Failed to query table info: %v", err)
	}
	defer rows.Close()

	expectedColumns := map[string]bool{
		"id":        false,
		"name":      false,
		"type":      false,
		"height":    false,
		"levels":    false,
		"address":   false,
		"latitude":  false,
		"longitude": false,
	}

	for rows.Next() {
		var cid int
		var name, colType string
		var notNull, pk int
		var dfltValue sql.NullString

		if err := rows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); err != nil {
			t.Errorf("Failed to scan column info: %v", err)
			continue
		}

		if _, exists := expectedColumns[name]; exists {
			expectedColumns[name] = true
		}
	}

	for col, found := range expectedColumns {
		if !found {
			t.Errorf("Expected column '%s' not found in table", col)
		}
	}

	var indexCount int
	err = db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name='features'").Scan(&indexCount)
	if err != nil {
		t.Errorf("Failed to query indexes: %v", err)
	}
	if indexCount < 1 {
		t.Errorf("Expected at least 1 index, got %d", indexCount)
	}
}

func TestMetaStruct(t *testing.T) {
	meta := Meta{
		Name:    "Test Building",
		Height:  50.5,
		Levels:  15,
		Address: "123 Test Street",
	}

	if meta.Name != "Test Building" {
		t.Errorf("Expected Name to be 'Test Building', got '%s'", meta.Name)
	}
	if meta.Height != 50.5 {
		t.Errorf("Expected Height to be 50.5, got %f", meta.Height)
	}
	if meta.Levels != 15 {
		t.Errorf("Expected Levels to be 15, got %d", meta.Levels)
	}
	if meta.Address != "123 Test Street" {
		t.Errorf("Expected Address to be '123 Test Street', got '%s'", meta.Address)
	}
}

func TestDatabaseInsert(t *testing.T) {
	tmpDB := "test_insert.db"
	defer os.Remove(tmpDB)

	db, err := sql.Open("sqlite3", tmpDB)
	if err != nil {
		t.Fatalf("Failed to open test database: %v", err)
	}
	defer db.Close()

	setupDatabase(db)

	_, err = db.Exec("INSERT INTO features (name, type, height, levels, address, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)",
		"Test Building", "building", 100.0, 30, "Test Address", 51.5, -0.1)
	if err != nil {
		t.Errorf("Failed to insert test data: %v", err)
	}

	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM features WHERE name = ?", "Test Building").Scan(&count)
	if err != nil {
		t.Errorf("Failed to query inserted data: %v", err)
	}
	if count != 1 {
		t.Errorf("Expected 1 row, got %d", count)
	}

	var name, featType, address string
	var height float64
	var levels int
	var lat, lon float64

	err = db.QueryRow("SELECT name, type, height, levels, address, latitude, longitude FROM features WHERE name = ?", "Test Building").
		Scan(&name, &featType, &height, &levels, &address, &lat, &lon)
	if err != nil {
		t.Errorf("Failed to retrieve inserted data: %v", err)
	}

	if name != "Test Building" || featType != "building" || height != 100.0 || levels != 30 {
		t.Errorf("Retrieved data doesn't match inserted data")
	}
	if lat != 51.5 || lon != -0.1 {
		t.Errorf("Retrieved coordinates don't match: got (%f, %f), want (51.5, -0.1)", lat, lon)
	}
}
