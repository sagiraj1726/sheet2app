'use strict';

/**
 * Fictional sample workbooks (used by the "Try demo" button, the sample generator script and the tests).
 * Deterministic: the same output every run. All names, numbers and addresses are invented.
 */
const ExcelJS = require('exceljs');

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Ananya', 'Vikram', 'Sana', 'Arjun', 'Isha', 'Neel', 'Tara', 'Dev', 'Riya', 'Kunal', 'Pooja', 'Sahil', 'Nisha', 'Yash', 'Kavya'];
const LAST = ['Sharma', 'Patel', 'Iyer', 'Reddy', 'Khan', 'Nair', 'Gupta', 'Das', 'Mehta', 'Singh'];

function styleHeader(ws, widths) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B5BDB' } };
  row.alignment = { vertical: 'middle' };
  row.height = 22;
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function employees(wb, seed = 11) {
  const r = rng(seed);
  const ws = wb.addWorksheet('Employees');
  ws.addRow(['Employee ID', 'Employee Name', 'Department', 'Joining Date', 'Salary', 'Email', 'Phone', 'Is Active', 'Notes']);
  const depts = ['Engineering', 'Sales', 'HR', 'Finance', 'Support'];
  for (let i = 1; i <= 24; i += 1) {
    const name = `${pick(r, FIRST)} ${pick(r, LAST)}`;
    const dept = pick(r, depts);
    ws.addRow([
      String(i).padStart(4, '0'),
      name,
      dept,
      utc(2018 + Math.floor(r() * 7), 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 27)),
      Math.round((300000 + r() * 900000) / 1000) * 1000,
      `${name.split(' ')[0].toLowerCase()}.${i}@example.com`,
      `98${String(Math.floor(r() * 1e8)).padStart(8, '0')}`,
      r() > 0.2 ? 'Yes' : 'No',
      i % 5 === 0 ? 'Leads the weekly review. Recently completed advanced training and is mentoring two new joiners this quarter.' : null,
    ]);
  }
  styleHeader(ws, [14, 22, 16, 14, 12, 30, 14, 10, 50]);
  ws.getColumn(4).numFmt = 'dd-mmm-yyyy';
  ws.getColumn(5).numFmt = '#,##0';
  return ws;
}

function expenses(wb, seed = 22) {
  const r = rng(seed);
  const ws = wb.addWorksheet('Monthly Expenses');
  ws.addRow(['Date', 'Category', 'Description', 'Amount', 'Paid By', 'Status']);
  const cats = [['Rent', 40000], ['Salaries', 90000], ['Marketing', 15000], ['Utilities', 8000], ['Travel', 9000], ['Software', 12000]];
  for (let m = 1; m <= 6; m += 1) {
    cats.forEach(([c, base], k) => {
      const growth = c === 'Marketing' ? 1 + m * 0.12 : 1;
      ws.addRow([
        utc(2025, m, 3 + k * 4),
        c,
        `${c} for ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'][m - 1]}`,
        Math.round((base * growth * (0.9 + r() * 0.25)) / 10) * 10,
        pick(r, ['Company card', 'Bank transfer', 'Cash']),
        m === 6 && k > 3 ? 'Pending' : 'Paid',
      ]);
    });
  }
  styleHeader(ws, [14, 14, 28, 12, 16, 10]);
  ws.getColumn(1).numFmt = 'dd-mmm-yyyy';
  ws.getColumn(4).numFmt = '#,##0';
  return ws;
}

function inventory(wb, seed = 33) {
  const r = rng(seed);
  const ws = wb.addWorksheet('Inventory');
  ws.addRow(['SKU', 'Product', 'Category', 'Quantity', 'Unit Price', 'Stock Value', 'Reorder Needed', 'Supplier']);
  const items = [['Notebook A5', 'Stationery', 40], ['Gel Pen Pack', 'Stationery', 90], ['Desk Lamp', 'Furniture', 900], ['Office Chair', 'Furniture', 5200], ['USB Cable', 'Electronics', 250], ['Wireless Mouse', 'Electronics', 650], ['Whiteboard', 'Furniture', 1800], ['Stapler', 'Stationery', 120], ['Headphones', 'Electronics', 1400], ['File Folder', 'Stationery', 35]];
  items.forEach(([p, c, price], i) => {
    const rowNo = i + 2;
    const qty = Math.floor(r() * 120);
    ws.addRow([
      `SKU-${String(100 + i).padStart(4, '0')}`, p, c, qty, price,
      { formula: `D${rowNo}*E${rowNo}`, result: qty * price },
      qty < 25 ? 'Yes' : 'No',
      pick(r, ['Metro Supplies', 'Bright Traders', 'Nova Wholesale']),
    ]);
  });
  styleHeader(ws, [12, 20, 14, 10, 12, 14, 15, 18]);
  ws.getColumn(5).numFmt = '#,##0.00';
  ws.getColumn(6).numFmt = '#,##0.00';
  return ws;
}

function students(wb, seed = 44) {
  const r = rng(seed);
  const ws = wb.addWorksheet('Student Marks');
  ws.addRow(['Roll No', 'Student', 'Class', 'Maths', 'Science', 'English', 'Attendance %', 'Remarks']);
  for (let i = 1; i <= 30; i += 1) {
    ws.addRow([
      String(i).padStart(3, '0'), `${pick(r, FIRST)} ${pick(r, LAST)}`, pick(r, ['8A', '8B', '9A']),
      Math.round(35 + r() * 65), Math.round(30 + r() * 70), Math.round(40 + r() * 60),
      Math.round(70 + r() * 30), i % 7 === 0 ? 'Needs extra support in Maths. Parent meeting scheduled for next month.' : null,
    ]);
  }
  styleHeader(ws, [9, 22, 8, 9, 9, 9, 14, 40]);
  return ws;
}

function leads(wb, seed = 55) {
  const r = rng(seed);
  const ws = wb.addWorksheet('Property Leads');
  ws.addRow(['Lead ID', 'Client', 'Locality', 'Budget', 'Status', 'Survey No', 'Next Follow Up', 'Website']);
  for (let i = 1; i <= 18; i += 1) {
    ws.addRow([
      `L-${1000 + i}`, `${pick(r, FIRST)} ${pick(r, LAST)}`, pick(r, ['Greenfield', 'Lakeview', 'Hillcrest', 'Old Town']),
      Math.round((2000000 + r() * 9000000) / 50000) * 50000,
      pick(r, ['New', 'Contacted', 'Site Visit', 'Negotiation', 'Closed']),
      `0${Math.floor(10 + r() * 80)}/${Math.floor(1 + r() * 9)}`,
      utc(2025, 7, 1 + Math.floor(r() * 28)),
      i % 4 === 0 ? `https://example.com/listing/${i}` : null,
    ]);
  }
  styleHeader(ws, [10, 22, 14, 14, 14, 12, 16, 32]);
  ws.getColumn(7).numFmt = 'yyyy-mm-dd';
  return ws;
}

/** A deliberately messy sheet: title rows, duplicate + missing headers, blank rows. */
function messy(wb) {
  const ws = wb.addWorksheet('Messy Report');
  ws.addRow(['Quarterly Sales Report - Fictional Co.']);
  ws.addRow([]);
  ws.addRow(['Region', 'Region', null, 'Sales']);
  ws.addRow(['North', 'Delhi', 'A', 1200]);
  ws.addRow([]);
  ws.addRow(['South', 'Chennai', 'B', 900]);
  ws.addRow(['South', 'Kochi', 'A', 1500]);
  return ws;
}

const BUILDERS = { employees, expenses, inventory, students, leads, messy };

async function buildWorkbook(names) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sheet2App samples';
  for (const n of names) BUILDERS[n](wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The workbook behind the "Try the demo" button. */
const demoWorkbook = () => buildWorkbook(['inventory', 'expenses', 'employees']);

module.exports = { buildWorkbook, demoWorkbook, BUILDERS };
