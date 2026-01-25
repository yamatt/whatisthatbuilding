const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: './src/js/index.js',
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'dist'),
  },
  externals: {
    aframe: 'AFRAME'
  },
  devtool: 'source-map',
  devServer: {
    static: './',
    hot: true,
    server: 'https', // IMPORTANT: Required for Camera/GPS
    port: 8080
  },
  resolve: {
    fallback: {
      "fs": false,
      "path": false,
      "crypto": false
    }
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'src/static/index.html', to: 'index.html' },
        { from: 'src/static/style.css', to: 'style.css' },
        { from: 'node_modules/spl.js/dist/index.wasm', to: 'index.wasm' },
        { from: 'node_modules/spl.js/dist/proj', to: 'proj' }
      ],
    }),
  ],
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
};