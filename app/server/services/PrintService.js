/**
 * PrintService - Server-side PDF generation for entity tables
 * Uses PDFKit to generate A4 Landscape PDFs with dynamic columns
 */

const PDFDocument = require('pdfkit');

class PrintService {
  constructor(options = {}) {
    this.pageWidth = 842;  // A4 Landscape
    this.pageHeight = 595;
    this.margin = 40;
    this.headerHeight = 50;
    this.rowHeight = 18;
    this.headerRowHeight = 22;
    this.defaultColor = '#1a365d';
  }

  /**
   * Draw a small right-pointing triangle (for FK references)
   * @param {PDFDocument} doc
   * @param {number} x - Left position
   * @param {number} y - Center Y position
   * @param {number} size - Triangle size (default 5)
   * @param {string} color - Fill color
   */
  drawRightTriangle(doc, x, y, size = 5, color = '#666666') {
    doc.save();
    doc.fillColor(color);
    doc.moveTo(x, y - size / 2)
       .lineTo(x + size, y)
       .lineTo(x, y + size / 2)
       .closePath()
       .fill();
    doc.restore();
  }

  /**
   * Draw a small left-pointing triangle (for back-references)
   * @param {PDFDocument} doc
   * @param {number} x - Right position of triangle
   * @param {number} y - Center Y position
   * @param {number} size - Triangle size (default 5)
   * @param {string} color - Fill color
   */
  drawLeftTriangle(doc, x, y, size = 5, color = '#666666') {
    doc.save();
    doc.fillColor(color);
    doc.moveTo(x, y - size / 2)
       .lineTo(x - size, y)
       .lineTo(x, y + size / 2)
       .closePath()
       .fill();
    doc.restore();
  }

  /**
   * Draw a small bullet/circle (for list items)
   * @param {PDFDocument} doc
   * @param {number} x - Center X position
   * @param {number} y - Center Y position
   * @param {number} radius - Circle radius (default 2)
   * @param {string} color - Fill color
   */
  drawBullet(doc, x, y, radius = 2, color = '#666666') {
    doc.save();
    doc.fillColor(color);
    doc.circle(x, y, radius).fill();
    doc.restore();
  }

  /**
   * Generate PDF and pipe to response
   * @param {Object} data - { title, columns, records, entityColor }
   * @param {Response} res - Express response object
   */
  generatePdf(data, res) {
    const { title, columns, records, entityColor } = data;
    const color = entityColor || this.defaultColor;

    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: this.margin,
      bufferPages: true
    });

    doc.pipe(res);

    // Draw title
    this.drawTitle(doc, title, color);

    // Draw table
    this.drawTable(doc, columns, records, color);

    // Add page numbers
    this.addPageNumbers(doc);

    doc.end();
  }

  /**
   * Draw document title with colored background bar
   */
  drawTitle(doc, title, color) {
    const tableWidth = this.pageWidth - 2 * this.margin;
    const titleBarHeight = 28;

    // Title bar with entity color background
    doc.rect(this.margin, this.margin, tableWidth, titleBarHeight)
       .fill(color);

    // Title text (black for readability on light colors)
    doc.fontSize(16)
       .fillColor('#000000')
       .text(title, this.margin + 10, this.margin + 7);

    // Add date on the right
    const date = new Date().toLocaleDateString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    doc.fontSize(9)
       .fillColor('#333333')
       .text(date, this.margin, this.margin + 9, {
         width: tableWidth - 10,
         align: 'right'
       });

    doc.y = this.margin + titleBarHeight + 10;
  }

  /**
   * Draw the data table
   */
  drawTable(doc, columns, records, headerColor) {
    const tableWidth = this.pageWidth - 2 * this.margin;
    const colCount = columns.length;

    // Calculate column widths proportionally
    // Give more space to text columns, less to numeric/date
    const colWidths = this.calculateColumnWidths(columns, records, tableWidth);

    let y = doc.y;

    // Draw header row
    y = this.drawHeaderRow(doc, columns, colWidths, y, headerColor);

    // Draw data rows
    for (let i = 0; i < records.length; i++) {
      // Check if we need a new page
      if (y + this.rowHeight > this.pageHeight - this.margin) {
        doc.addPage();
        y = this.margin;
        // Redraw header on new page
        y = this.drawHeaderRow(doc, columns, colWidths, y, headerColor);
      }

      // Alternating row background
      if (i % 2 === 1) {
        doc.rect(this.margin, y, tableWidth, this.rowHeight)
           .fill('#f7fafc');
      }

      // Draw row data
      let x = this.margin;
      doc.fontSize(8).fillColor('#000000');

      for (let j = 0; j < columns.length; j++) {
        const col = columns[j];
        const value = records[i][col.key];
        const text = value != null ? String(value) : '';

        doc.text(text, x + 3, y + 4, {
          width: colWidths[j] - 6,
          height: this.rowHeight - 2,
          ellipsis: true,
          lineBreak: false
        });

        x += colWidths[j];
      }

      y += this.rowHeight;
    }

    // Draw table border
    const tableHeight = y - (doc.y - this.headerRowHeight);
    doc.rect(this.margin, doc.y - this.headerRowHeight, tableWidth, y - (doc.y - this.headerRowHeight))
       .stroke('#cccccc');
  }

  /**
   * Draw table header row with per-column colors
   */
  drawHeaderRow(doc, columns, colWidths, y, defaultColor) {
    let x = this.margin;

    // Draw each column header with its own background color
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const label = col.label || col.key;
      const colColor = col.color || defaultColor;

      // Column background
      doc.rect(x, y, colWidths[i], this.headerRowHeight)
         .fill(colColor);

      // Column text (black for readability on light area colors)
      doc.fontSize(9).fillColor('#000000');
      doc.text(label, x + 3, y + 5, {
        width: colWidths[i] - 6,
        height: this.headerRowHeight - 2,
        ellipsis: true,
        lineBreak: false
      });

      x += colWidths[i];
    }

    return y + this.headerRowHeight;
  }

  /**
   * Calculate column widths based on content
   */
  calculateColumnWidths(columns, records, tableWidth) {
    const colCount = columns.length;

    // Start with equal widths
    const widths = new Array(colCount).fill(tableWidth / colCount);

    // Adjust based on content length (sample first 20 rows)
    const sampleSize = Math.min(20, records.length);
    const maxLengths = new Array(colCount).fill(0);

    // Check header lengths
    columns.forEach((col, i) => {
      const label = col.label || col.key;
      maxLengths[i] = Math.max(maxLengths[i], label.length);
    });

    // Check content lengths
    for (let r = 0; r < sampleSize; r++) {
      columns.forEach((col, i) => {
        const value = records[r][col.key];
        const text = value != null ? String(value) : '';
        maxLengths[i] = Math.max(maxLengths[i], text.length);
      });
    }

    // Calculate proportional widths
    const totalLength = maxLengths.reduce((a, b) => a + b, 0);
    if (totalLength > 0) {
      maxLengths.forEach((len, i) => {
        widths[i] = Math.max(40, (len / totalLength) * tableWidth);
      });

      // Normalize to fit exactly
      const totalWidth = widths.reduce((a, b) => a + b, 0);
      const scale = tableWidth / totalWidth;
      widths.forEach((w, i) => {
        widths[i] = w * scale;
      });
    }

    return widths;
  }

  /**
   * Add page numbers to all pages
   */
  addPageNumbers(doc) {
    const range = doc.bufferedPageRange();
    const footerY = this.pageHeight - 25;

    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      // Reset position to prevent new page creation
      doc.y = footerY;
      doc.x = this.margin;

      doc.fontSize(8).fillColor('#999999');

      // Draw page number directly without triggering page break
      const pageText = `Page ${i + 1} of ${range.count}`;
      const pageTextWidth = doc.widthOfString(pageText);
      const centerX = this.margin + (this.pageWidth - 2 * this.margin - pageTextWidth) / 2;

      doc.text(pageText, centerX, footerY, { lineBreak: false });
    }
  }

  /**
   * Generate hierarchical tree PDF
   * @param {Object} data - { title, nodes, entityColor }
   *   nodes: [{ type, depth, label, value, color }]
   *   type: 'root' | 'section' | 'attribute' | 'fk' | 'backref' | 'backref-item'
   * @param {Response} res - Express response object
   */
  generateTreePdf(data, res) {
    const { title, nodes, entityColor } = data;
    const color = entityColor || this.defaultColor;

    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: this.margin,
      bufferPages: true
    });

    doc.pipe(res);

    // Draw title
    this.drawTitle(doc, title, color);

    // Draw tree nodes
    this.drawTreeNodes(doc, nodes);

    // Add page numbers
    this.addPageNumbers(doc);

    doc.end();
  }

  /**
   * Draw tree nodes with hierarchical structure
   */
  drawTreeNodes(doc, nodes) {
    const tableWidth = this.pageWidth - 2 * this.margin;
    const indentSize = 20;
    const sectionHeight = 22;
    const attrHeight = 16;

    let y = doc.y;

    for (const node of nodes) {
      const indent = node.depth * indentSize;
      const contentWidth = tableWidth - indent;

      // Check for page break
      const nodeHeight = (node.type === 'attribute' || node.type === 'backref-item') ? attrHeight : sectionHeight;
      if (y + nodeHeight > this.pageHeight - this.margin - 20) {
        doc.addPage();
        y = this.margin;
      }

      const x = this.margin + indent;

      if (node.type === 'root' || node.type === 'section') {
        // Section header with colored background
        const bgColor = node.color || '#e2e8f0';
        doc.rect(x, y, contentWidth, sectionHeight).fill(bgColor);

        // Section text
        doc.fontSize(10).fillColor('#000000');
        doc.text(node.label, x + 8, y + 5, {
          width: contentWidth * 0.35 - 10,
          height: sectionHeight - 4,
          ellipsis: true,
          lineBreak: false
        });

        // Section value (bold)
        doc.font('Helvetica-Bold');
        doc.text(node.value || '', x + contentWidth * 0.35, y + 5, {
          width: contentWidth * 0.65 - 10,
          height: sectionHeight - 4,
          ellipsis: true,
          lineBreak: false
        });
        doc.font('Helvetica');

        y += sectionHeight + 2;

      } else if (node.type === 'fk') {
        // FK reference with colored left border
        const bgColor = node.color || '#e2e8f0';
        const borderWidth = 4;

        // Left color border
        doc.rect(x, y, borderWidth, sectionHeight).fill(bgColor);
        // Light background
        doc.rect(x + borderWidth, y, contentWidth - borderWidth, sectionHeight).fill('#f8fafc');

        // FK icon (right-pointing triangle)
        const iconX = x + borderWidth + 6;
        const iconY = y + sectionHeight / 2;
        this.drawRightTriangle(doc, iconX, iconY, 5, '#666666');

        // FK label (offset for icon)
        doc.fontSize(9).fillColor('#666666');
        doc.text(node.label, x + borderWidth + 14, y + 5, {
          width: contentWidth * 0.35 - borderWidth - 18,
          height: sectionHeight - 4,
          ellipsis: true,
          lineBreak: false
        });

        // FK value
        doc.fillColor('#000000');
        doc.text(node.value || '', x + contentWidth * 0.35, y + 5, {
          width: contentWidth * 0.65 - 10,
          height: sectionHeight - 4,
          ellipsis: true,
          lineBreak: false
        });

        y += sectionHeight + 1;

      } else if (node.type === 'backref') {
        // Back-reference header
        const bgColor = node.color || '#e2e8f0';
        const borderWidth = 4;

        // Left color border
        doc.rect(x, y, borderWidth, sectionHeight).fill(bgColor);
        // Light background
        doc.rect(x + borderWidth, y, contentWidth - borderWidth, sectionHeight).fill('#f0f4f8');

        // Backref icon (left-pointing triangle)
        const iconX = x + borderWidth + 11;
        const iconY = y + sectionHeight / 2;
        this.drawLeftTriangle(doc, iconX, iconY, 5, '#666666');

        // Backref label (offset for icon)
        doc.fontSize(9).fillColor('#666666');
        doc.text(node.label, x + borderWidth + 14, y + 5, {
          width: contentWidth * 0.35 - borderWidth - 18,
          height: sectionHeight - 4,
          ellipsis: true,
          lineBreak: false
        });

        // Count
        doc.fillColor('#000000');
        doc.text(node.value || '', x + contentWidth * 0.35, y + 5, {
          width: contentWidth * 0.65 - 10,
          height: sectionHeight - 4,
          ellipsis: true,
          lineBreak: false
        });

        y += sectionHeight + 1;

      } else if (node.type === 'backref-item') {
        // Back-reference item (record in list)
        doc.rect(x, y, contentWidth, attrHeight).fill('#fafafa');

        // Bullet point
        this.drawBullet(doc, x + 8, y + attrHeight / 2, 2, '#666666');

        // Label (offset for bullet)
        doc.fontSize(8).fillColor('#666666');
        doc.text(node.label, x + 14, y + 3, {
          width: contentWidth * 0.35 - 18,
          height: attrHeight - 2,
          ellipsis: true,
          lineBreak: false
        });

        doc.fillColor('#000000');
        doc.text(node.value || '', x + contentWidth * 0.35, y + 3, {
          width: contentWidth * 0.65 - 10,
          height: attrHeight - 2,
          ellipsis: true,
          lineBreak: false
        });

        y += attrHeight;

      } else if (node.type === 'attribute-row') {
        // Horizontal attribute table (row layout)
        const cols = node.columns || [];
        const vals = node.values || [];
        if (cols.length === 0) continue;

        const headerHeight = 14;
        const rowHeight = 16;
        const tableHeight = headerHeight + rowHeight;

        // Check for page break
        if (y + tableHeight > this.pageHeight - this.margin - 20) {
          doc.addPage();
          y = this.margin;
        }

        // Calculate column widths (equal distribution)
        const colWidth = contentWidth / cols.length;

        // Draw header row with column names
        doc.rect(x, y, contentWidth, headerHeight).fill('#f1f5f9');
        doc.fontSize(7).fillColor('#666666');
        for (let i = 0; i < cols.length; i++) {
          doc.text(cols[i], x + i * colWidth + 3, y + 3, {
            width: colWidth - 6,
            height: headerHeight - 4,
            ellipsis: true,
            lineBreak: false
          });
        }
        y += headerHeight;

        // Draw value row
        doc.rect(x, y, contentWidth, rowHeight).fill('#ffffff');
        doc.fontSize(8).fillColor('#000000');
        for (let i = 0; i < vals.length; i++) {
          doc.text(vals[i] || '', x + i * colWidth + 3, y + 3, {
            width: colWidth - 6,
            height: rowHeight - 4,
            ellipsis: true,
            lineBreak: false
          });
        }
        y += rowHeight + 2;

      } else {
        // Regular attribute (list layout)
        // Light alternating background
        const bgColor = (node.depth % 2 === 0) ? '#ffffff' : '#f9fafb';
        doc.rect(x, y, contentWidth, attrHeight).fill(bgColor);

        // Attribute label
        doc.fontSize(8).fillColor('#666666');
        doc.text(node.label, x + 6, y + 3, {
          width: contentWidth * 0.35 - 10,
          height: attrHeight - 2,
          ellipsis: true,
          lineBreak: false
        });

        // Attribute value
        doc.fillColor('#000000');
        doc.text(node.value || '', x + contentWidth * 0.35, y + 3, {
          width: contentWidth * 0.65 - 10,
          height: attrHeight - 2,
          ellipsis: true,
          lineBreak: false
        });

        y += attrHeight;
      }
    }
  }
}

module.exports = PrintService;
