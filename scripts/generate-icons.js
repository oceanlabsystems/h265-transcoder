const fs = require('fs');
const path = require('path');

const resourcesDir = path.join(__dirname, '..', 'resources');
const svgPath = path.join(resourcesDir, 'icon.svg');

console.log('Generating app icons from SVG...\n');

// Check if sharp is available (for PNG generation)
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('Error: sharp package is required. Install it with: npm install --save-dev sharp');
  console.error('\nAlternatively, you can:');
  console.error('1. Install sharp: npm install --save-dev sharp');
  console.error('2. Or use online tools to convert resources/icon.svg:');
  console.error('   - Windows: https://convertio.co/svg-ico/ (create ICO with sizes: 16, 32, 48, 64, 128, 256)');
  console.error('   - Mac: https://cloudconvert.com/svg-to-icns (or use icon.png)');
  console.error('   - Linux: Use icon.png (1024x1024)');
  process.exit(1);
}

// Generate PNG files in various sizes
const sizes = {
  png: [512, 1024],
  ico: [16, 32, 48, 64, 128, 256],
  mac: [16, 32, 64, 128, 256, 512, 1024]
};

async function generateIcons() {
  try {
    // Generate base PNG (1024x1024) for Mac and Linux
    console.log('Generating PNG files...');
    await sharp(svgPath)
      .resize(1024, 1024)
      .png()
      .toFile(path.join(resourcesDir, 'icon.png'));
    console.log('✓ Created icon.png (1024x1024)');

    // Generate 512x512 PNG for Linux
    await sharp(svgPath)
      .resize(512, 512)
      .png()
      .toFile(path.join(resourcesDir, 'icon-512.png'));
    console.log('✓ Created icon-512.png');

    // Generate ICO file for Windows
    // Note: sharp doesn't support ICO directly, so we'll try to use to-ico if available
    console.log('\nGenerating ICO file for Windows...');
    let icoCreated = false;
    
    try {
      const toIco = require('to-ico');
      const icoSizes = sizes.ico;
      const icoBuffers = await Promise.all(
        icoSizes.map(size =>
          sharp(svgPath)
            .resize(size, size)
            .png()
            .toBuffer()
        )
      );
      
      const icoBuffer = await toIco(icoBuffers);
      fs.writeFileSync(path.join(resourcesDir, 'icon.ico'), icoBuffer);
      console.log('✓ Created icon.ico with multiple sizes (16, 32, 48, 64, 128, 256)');
      icoCreated = true;
    } catch (e) {
      // to-ico not available, create a 256x256 PNG as fallback
      await sharp(svgPath)
        .resize(256, 256)
        .png()
        .toFile(path.join(resourcesDir, 'icon.ico'));
      console.log('⚠ Created icon.ico (256x256 PNG - not true ICO format)');
      console.log('  Install to-ico for proper ICO: npm install --save-dev to-ico');
      console.log('  Or convert manually: https://convertio.co/png-ico/');
    }

    // For Mac, electron-builder can use PNG directly, but ICNS is better
    console.log('\n✓ Icon generation complete!');
    if (!icoCreated) {
      console.log('\nOptional: Install to-ico for proper Windows ICO support:');
      console.log('  npm install --save-dev to-ico');
      console.log('  Then run: npm run generate-icons');
    }
    console.log('\nIcons are ready for:');
    console.log('  ✓ Windows: icon.ico');
    console.log('  ✓ Mac: icon.png (electron-builder will use this)');
    console.log('  ✓ Linux: icon.png');

  } catch (error) {
    console.error('Error generating icons:', error);
    process.exit(1);
  }
}

generateIcons();
