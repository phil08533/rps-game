const fs = require('fs');
const { PNG } = require('pngjs');

// Load a sprite
const data = fs.readFileSync('docs/avatars/Char 2/sprite.png');
const png = PNG.sync.read(data);

const frameSize = 64;
const cols = png.width / frameSize; // 768 / 64 = 12
const rows = png.height / frameSize; // 1408 / 64 = 22

function isFrameEmpty(col, row) {
  let startX = col * frameSize;
  let startY = row * frameSize;
  
  for (let y = startY; y < startY + frameSize; y++) {
    for (let x = startX; x < startX + frameSize; x++) {
      let idx = (png.width * y + x) << 2;
      let alpha = png.data[idx + 3]; // alpha channel
      if (alpha > 0) {
        return false; // not empty
      }
    }
  }
  return true; // entirely empty
}

for (let r = 0; r < rows; r++) {
  let frameCount = 0;
  for (let c = 0; c < cols; c++) {
    if (!isFrameEmpty(c, r)) {
      frameCount++;
    } else {
      break; // Assuming contiguous left-to-right frames
    }
  }
  console.log(`Row ${r+1}: ${frameCount} frames`);
}
