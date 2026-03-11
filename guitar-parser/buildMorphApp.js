#!/usr/bin/env node
const fs = require('fs');

const template  = fs.readFileSync('./morph_app_template.html', 'utf8');
const finalData = JSON.parse(fs.readFileSync('./guitar_final.json', 'utf8'));
const lmData    = JSON.parse(fs.readFileSync('./guitar_landmarks.json', 'utf8'));
const orgData   = JSON.parse(fs.readFileSync('./guitars_organized.json', 'utf8'));

const html = template
  .replace('FINAL_DATA',    JSON.stringify(finalData))
  .replace('LANDMARK_DATA', JSON.stringify(lmData))
  .replace('ORGANIZED_DATA',JSON.stringify(orgData));

const outPath = './guitar_morph_app.html';
fs.writeFileSync(outPath, html);
console.log('Built ' + outPath + ' (' + (html.length/1024).toFixed(1) + ' KB)');
