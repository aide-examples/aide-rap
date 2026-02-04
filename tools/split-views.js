/**
 * Split Views.md into individual view files per area subdirectory
 *
 * Usage: node tools/split-views.js <system>
 * Example: node tools/split-views.js irma
 *
 * Input:  docs/ui/Views.md (H2 = Area, H3 = View)
 * Output: docs/views/{Area}/{ViewName}.md
 */

const fs = require('fs');
const path = require('path');

function splitViews(viewsMdPath, outputDir) {
  if (!fs.existsSync(viewsMdPath)) {
    console.log(`No Views.md found at ${viewsMdPath}`);
    return;
  }

  const content = fs.readFileSync(viewsMdPath, 'utf-8');
  const lines = content.split('\n');

  let currentArea = null;
  let currentView = null;
  let viewContent = [];
  let viewCount = 0;

  function saveView() {
    if (currentView && currentArea && viewContent.length > 0) {
      // Create area subdirectory
      const areaDir = path.join(outputDir, currentArea);
      fs.mkdirSync(areaDir, { recursive: true });

      // Write view file - H1 header + content (no Section: line needed)
      let fileContent = `# ${currentView}\n\n`;
      fileContent += viewContent.join('\n').trim() + '\n';

      const filename = `${currentView}.md`;
      fs.writeFileSync(path.join(areaDir, filename), fileContent);
      console.log(`  Created: ${currentArea}/${filename}`);
      viewCount++;
    }
  }

  for (const line of lines) {
    if (line.startsWith('## ')) {
      // New area - save previous view first
      saveView();
      currentArea = line.substring(3).trim();
      currentView = null;
      viewContent = [];
    } else if (line.startsWith('### ')) {
      // New view within area
      saveView();
      currentView = line.substring(4).trim();
      viewContent = [];
    } else if (currentView) {
      // Content for current view
      viewContent.push(line);
    }
  }
  // Save last view
  saveView();

  console.log(`\nTotal: ${viewCount} views created`);
}

// Main
const system = process.argv[2];
if (!system) {
  console.log('Usage: node tools/split-views.js <system>');
  console.log('Available systems: book_1, book_2, flow, irma');
  process.exit(1);
}

const systemDir = path.join(__dirname, '..', 'app', 'systems', system);
if (!fs.existsSync(systemDir)) {
  console.error(`System directory not found: ${systemDir}`);
  process.exit(1);
}

const viewsMdPath = path.join(systemDir, 'docs', 'ui', 'Views.md');
const outputDir = path.join(systemDir, 'docs', 'views');

console.log(`Splitting Views.md for system: ${system}`);
console.log(`  Source: ${viewsMdPath}`);
console.log(`  Output: ${outputDir}\n`);

splitViews(viewsMdPath, outputDir);
