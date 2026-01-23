// #!/usr/bin/env node
// /**
//  * Code Verification Script
//  * Verifies syntax and import structure without requiring database connection
//  */

// import { execSync } from 'child_process';
// import fs from 'fs';
// import path from 'path';

// console.log('🔍 MYRA Backend Code Verification\n');
// console.log('=' .repeat(60));

// let passed = 0;
// let failed = 0;

// // Test 1: Check all JS files for syntax errors
// console.log('\n📋 Test 1: JavaScript Syntax Check');
// console.log('-'.repeat(60));

// const jsFiles = [
//   'index.js',
//   'src/app.js',
//   'src/config/dbConfig.js',
//   'src/config/environment.js',
//   'src/database/credentialRepository.js',
//   'src/database/documentRepository.js',
//   'src/database/index.js',
//   'src/database/syncLogsRepository.js',
//   'src/schemas/index.js',
//   'src/utils/logger.js',
//   'src/utils/validation.js',
// ];

// jsFiles.forEach(file => {
//   try {
//     execSync(`node --check ${file}`, { stdio: 'pipe' });
//     console.log(`✓ ${file.padEnd(50)} PASS`);
//     passed++;
//   } catch (error) {
//     console.log(`✗ ${file.padEnd(50)} FAIL`);
//     failed++;
//   }
// });

// // Test 2: Check import/export structure
// console.log('\n📦 Test 2: Import/Export Structure Check');
// console.log('-'.repeat(60));

// const checks = [
//   {
//     name: 'ES6 module type in package.json',
//     test: () => {
//       const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
//       return pkg.type === 'module';
//     }
//   },
//   {
//     name: 'All imports use .js extension',
//     test: () => {
//       const files = jsFiles.filter(f => f.includes('src/'));
//       return files.every(file => {
//         const content = fs.readFileSync(file, 'utf8');
//         const imports = content.match(/from\s+['"]\.\.?\/[^'"]+['"]/g) || [];
//         return imports.every(imp => imp.includes('.js'));
//       });
//     }
//   },
//   {
//     name: 'No CommonJS module.exports found',
//     test: () => {
//       const files = jsFiles.filter(f => f.includes('src/'));
//       return files.every(file => {
//         const content = fs.readFileSync(file, 'utf8');
//         return !content.includes('module.exports');
//       });
//     }
//   },
//   {
//     name: 'Database repositories use correct import paths',
//     test: () => {
//       const repoFiles = [
//         'src/database/documentRepository.js',
//         'src/database/credentialRepository.js',
//         'src/database/syncLogsRepository.js',
//       ];
//       return repoFiles.every(file => {
//         const content = fs.readFileSync(file, 'utf8');
//         return content.includes("from '../config/dbConfig.js'");
//       });
//     }
//   },
// ];

// checks.forEach(check => {
//   try {
//     const result = check.test();
//     if (result) {
//       console.log(`✓ ${check.name.padEnd(50)} PASS`);
//       passed++;
//     } else {
//       console.log(`✗ ${check.name.padEnd(50)} FAIL`);
//       failed++;
//     }
//   } catch (error) {
//     console.log(`✗ ${check.name.padEnd(50)} ERROR`);
//     failed++;
//   }
// });

// // Test 3: Check for potential SQL injection
// console.log('\n🔒 Test 3: SQL Injection Prevention Check');
// console.log('-'.repeat(60));

// const repoFiles = [
//   'src/database/documentRepository.js',
//   'src/database/credentialRepository.js',
//   'src/database/syncLogsRepository.js',
// ];

// let sqlInjectionIssues = 0;

// repoFiles.forEach(file => {
//   const content = fs.readFileSync(file, 'utf8');

//   // Check for template literals in SQL queries with INTERVAL
//   const dangerousPattern = /INTERVAL\s+['"]\$\{/g;
//   const matches = content.match(dangerousPattern);

//   if (matches && matches.length > 0) {
//     console.log(`✗ ${file.padEnd(50)} Found ${matches.length} SQL injection risk(s)`);
//     sqlInjectionIssues += matches.length;
//     failed++;
//   } else {
//     console.log(`✓ ${file.padEnd(50)} No SQL injection risks`);
//     passed++;
//   }
// });

// // Summary
// console.log('\n' + '='.repeat(60));
// console.log('📊 Summary');
// console.log('='.repeat(60));
// console.log(`Total Tests: ${passed + failed}`);
// console.log(`✓ Passed: ${passed}`);
// console.log(`✗ Failed: ${failed}`);

// if (failed === 0) {
//   console.log('\n🎉 All checks passed! Code is ready to run.');
//   console.log('\n💡 Next steps:');
//   console.log('   1. Ensure your database is running');
//   console.log('   2. Verify .env file has correct credentials');
//   console.log('   3. Run: npm start');
//   process.exit(0);
// } else {
//   console.log('\n⚠️  Some checks failed. Please review the issues above.');
//   process.exit(1);
// }

import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function testEmbedding() {
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

  const result = await model.embedContent({
    content: { parts: [{ text: "Hello world" }] },
    outputDimensionality: 1536, // Use 1536 instead of 3072 to save space
  });

  console.log(`✅ Embedding dimensions: ${result.embedding.values.length}`);
  console.log(`✅ First 5 values: ${result.embedding.values.slice(0, 5)}`);
}

testEmbedding();
