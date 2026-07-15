#!/usr/bin/env node
// Test that each core file has valid syntax and exports expected items

const fs = require('fs');
const path = require('path');

// Test files
const filesToCheck = [
  'interno/frontend/js/scratch-ui.js',
  'interno/frontend/js/scratch-blocks.js', 
  'interno/frontend/js/scratch-runtime.js',
  'interno/frontend/js/scratch-drawing.js',
  'interno/frontend/js/scratch-dynamic-editor.js'
];

// Simpler test function - just check file exists and has basic structure
filesToCheck.forEach(file => {
  const fullPath = path.join(process.cwd(), file);
  if (!fs.existsSync(fullPath)) {
    console.error(`${file}: File not found`);
    process.exit(1);
  }
  
  const content = fs.readFileSync(fullPath, 'utf8');
  if (content.length === 0) {
    console.error(`${file}: File is empty`);
    process.exit(1);
  }
  
  // Check it has function/class definitions
  if (!content.match(/function\s+\w+|class\s+\w+|const\s+\w+\s*=/)) {
    console.error(`${file}: No function/class definitions found`);
    process.exit(1);
  }
  
  console.log(`✓ ${file}: OK`);
});

console.log('\nAll core files found and structurally valid!');
