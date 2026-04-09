const fs = require('fs');

function getDimensions(imgPath) {
  const buf = fs.readFileSync(imgPath);
  // PNG signature
  if (buf.toString('hex', 0, 8) === '89504e470d0a1a0a') {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    console.log(`Dimensions for ${imgPath}: ${width}x${height}`);
  }
}

getDimensions('C:\\Users\\phili\\OneDrive\\Desktop\\rps-game\\images\\72 Character Free\\Char 1\\Character 1.png');
