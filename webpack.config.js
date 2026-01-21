const path = require('path');

module.exports = {
  entry: './src/index.js',
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
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
};