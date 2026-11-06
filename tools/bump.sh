#!/bin/sh
# cache-bust: stamp every local module URL with a new version
V=$(date +%s)
cd "$(dirname "$0")/.."
sed -i -E "s#(js/app\.js)(\?v=[0-9]+)?#\1?v=$V#" index.html
sed -i -E "s#(style\.css)(\?v=[0-9]+)?#\1?v=$V#" index.html
sed -i -E "s#'\./(catalog|garment|tryon)\.js(\?v=[0-9]+)?'#'./\1.js?v=$V'#g" js/*.js
