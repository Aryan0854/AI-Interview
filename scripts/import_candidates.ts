import ExcelJS from 'exceljs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// --- CONFIGURATION ---
const QUESTION_BANK_FILE = 'c:/Users/aryanmi/OneDrive - Infinite Computer Solutions (India) Limited/Desktop/Interviee/Question Bank-20th July \'26.xlsx';
const RESOURCE_FILE = 'c:/Users/aryanmi/OneDrive - Infinite Computer Solutions (India) Limited/Desktop/Interviee/Resource details less tahn 3.5 rating.xlsx';
const OUTPUT_FILE = 'Processed_Candidate_Mappings.xlsx';
const ACCOUNTS_STORE_FILE = 'c:/Users/aryanmi/OneDrive - Infinite Computer Solutions (India) Limited/Desktop/Interviee/src/data/employee-accounts.json';
const AUTH_SECRET = "dev-employee-auth-secret"; // We assume it's this or process.env

// We bypass the actual DB connection for this script by generating SQL statements
// OR we can use the supabase client directly if available in the env.
// For robust execution, we will use Supabase client.
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: 'c:/Users/aryanmi/OneDrive - Infinite Computer Solutions (India) Limited/Desktop/Interviee/.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

function normalizeProduct(name: string): string {
    if (!name) return '';
    return name.toString()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

function hashPassword(password: string) {
    const salt = crypto.randomBytes(16).toString("base64");
    const hash = crypto.pbkdf2Sync(password, salt, 120_000, 64, "sha512").toString("base64");
    return { hash, salt };
}

function generatePassword(empName: string, email: string): string {
    // EMP@<FirstName><Last4Mobile> or EMP@2026<Random4Digits>
    const firstName = empName ? empName.split(' ')[0] : 'User';
    // We don't have mobile, use random 4 digits
    const random4 = Math.floor(1000 + Math.random() * 9000);
    return `EMP@${firstName}${random4}`;
}

async function run() {
    console.log('--- Starting Candidate & Question Bank Importer ---');

    // 1. Process Question Bank
    console.log('\\n1. Processing Question Bank...');
    const qb = new ExcelJS.Workbook();
    await qb.xlsx.readFile(QUESTION_BANK_FILE);

    // map of normalized product name -> { productOriginal, questions: [] }
    const productBanks: Record<string, {
        original: string,
        questions: { qText: string, options: string[], correctIndex: number, explanation: string, difficulty: string }[]
    }> = {};

    for (const ws of qb.worksheets) {
        const originalProductName = ws.name;
        const normName = normalizeProduct(originalProductName);
        if (!productBanks[normName]) {
            productBanks[normName] = { original: originalProductName, questions: [] };
        }

        let currentQuestionText = '';
        let currentOptions: string[] = [];
        let currentCorrectIndex = 0;

        ws.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // skip header

            // Assume standard format:
            // Col 2: Q. No, Col 3: Domain, Col 4: Product, Col 5: Question, Col 6: Option, Col 7: Correct Answer
            const qText = row.getCell(5).value?.toString().trim();
            const optionText = row.getCell(6).value?.toString().trim();
            const correctness = row.getCell(7).value?.toString().trim().toLowerCase();

            if (!qText || !optionText) return; // skip empty rows

            if (qText !== currentQuestionText) {
                // Save previous question
                if (currentQuestionText && currentOptions.length >= 2) {
                    productBanks[normName].questions.push({
                        qText: currentQuestionText,
                        options: [...currentOptions],
                        correctIndex: currentCorrectIndex,
                        explanation: 'Auto-imported from Excel',
                        difficulty: 'medium'
                    });
                }
                // Start new question
                currentQuestionText = qText;
                currentOptions = [];
                currentCorrectIndex = 0;
            }

            currentOptions.push(optionText);
            if (correctness === 'correct' || correctness === 'true' || correctness === 'yes') {
                currentCorrectIndex = currentOptions.length - 1;
            }
        });

        // Add the last question
        if (currentQuestionText && currentOptions.length >= 2) {
            productBanks[normName].questions.push({
                qText: currentQuestionText,
                options: [...currentOptions],
                correctIndex: currentCorrectIndex,
                explanation: 'Auto-imported from Excel',
                difficulty: 'medium'
            });
        }
    }

    console.log(`Loaded ${Object.keys(productBanks).length} product banks.`);

    // 2. Process Candidates
    console.log('\\n2. Processing Candidates...');
    const rd = new ExcelJS.Workbook();
    await rd.xlsx.readFile(RESOURCE_FILE);
    const candidateWs = rd.worksheets[0];

    const candidates: any[] = [];
    const missingProducts: any[] = [];

    candidateWs.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // skip header

        const empId = row.getCell(2).value?.toString().trim();
        const empName = row.getCell(3).value?.toString().trim();
        const role = row.getCell(4).value?.toString().trim();
        const domainStr = row.getCell(5).value?.toString().trim() || '';
        const email = row.getCell(8).value?.toString().trim();

        if (!empId || !empName) return;

        const domains = domainStr.split(/[\\/\\-]/).map(d => normalizeProduct(d)).filter(d => d);
        const matchedBanks: any[] = [];
        
        for (const d of domains) {
            // Try direct match or partial match
            const directMatch = productBanks[d];
            if (directMatch && directMatch.questions.length > 0) {
                matchedBanks.push(directMatch);
            } else {
                // Try finding a bank that contains this domain name (e.g. 'hlrhss' in 'hlrhsscnfdeployment')
                const partialMatch = Object.keys(productBanks).find(bank => bank.includes(d) || d.includes(bank));
                if (partialMatch && productBanks[partialMatch].questions.length > 0) {
                    matchedBanks.push(productBanks[partialMatch]);
                }
            }
        }

        if (matchedBanks.length > 0) {
            // Remove duplicates
            const uniqueBanks = [...new Map(matchedBanks.map(b => [b.original, b])).values()];
            candidates.push({ empId, empName, role, originalProduct: domainStr, email, matchedBanks: uniqueBanks });
        } else {
            missingProducts.push({ empId, empName, originalProduct: domainStr });
        }
    });

    console.log(`Matched ${candidates.length} candidates. Failed to match ${missingProducts.length} candidates.`);
    if (missingProducts.length > 0) {
        console.log('Sample missing products:', [...new Set(missingProducts.map(m => m.originalProduct))].slice(0, 10));
    }
    console.log('Loaded normalized product banks:', Object.keys(productBanks));

    // 3. Employee Portal Integration (Auth Store)
    console.log('\\n3. Updating Auth Store & Generating Passwords...');
    let accountStore = { employees: [] as any[] };
    if (fs.existsSync(ACCOUNTS_STORE_FILE)) {
        accountStore = JSON.parse(fs.readFileSync(ACCOUNTS_STORE_FILE, 'utf8'));
    }

    const outputCredentials: any[] = [];
    const outputMappings: any[] = [];

    for (const cand of candidates) {
        const password = generatePassword(cand.empName, cand.email);
        const { hash, salt } = hashPassword(password);

        outputCredentials.push({ empId: cand.empId, empName: cand.empName, password });
        
        for (const bank of cand.matchedBanks) {
            outputMappings.push({ empId: cand.empId, empName: cand.empName, originalProduct: cand.originalProduct, mappedProduct: bank.original });
        }

        // Update JSON
        const existingAccIndex = accountStore.employees.findIndex(e => e.employee_id === cand.empId);
        if (existingAccIndex >= 0) {
            accountStore.employees[existingAccIndex].password_hash = hash;
            accountStore.employees[existingAccIndex].password_salt = salt;
            accountStore.employees[existingAccIndex].is_first_login = false;
        } else {
            accountStore.employees.push({
                employee_id: cand.empId,
                full_name: cand.empName,
                email: cand.email || `${cand.empId}@example.com`,
                department: 'general',
                role: cand.role || 'employee',
                is_first_login: false,
                password_hash: hash,
                password_salt: salt,
                xp_points: 0,
                streak_days: 0,
                skill_level: 'Beginner',
                ai_readiness_score: 0
            });
        }
    }
    fs.writeFileSync(ACCOUNTS_STORE_FILE, JSON.stringify(accountStore, null, 2));
    console.log(`Updated auth store at ${ACCOUNTS_STORE_FILE}`);

    // 4. Supabase DB Sync
    console.log('\\n4. Syncing to Supabase DB & Assigning Tests...');
    // We need a dummy topic id for the tests
    // Check if learning_subjects exists
    let { data: subjectData } = await supabase.from('learning_subjects').select('id').eq('title', 'Question Banks').maybeSingle();
    if (!subjectData) {
        const { data: newSub } = await supabase.from('learning_subjects').insert({ title: 'Question Banks', description: 'Auto-imported products', icon: 'Database' }).select('id').single();
        subjectData = newSub;
    }

    let { data: moduleData } = await supabase.from('learning_modules').select('id').eq('title', 'Imported Tests').maybeSingle();
    if (!moduleData) {
        const { data: newMod } = await supabase.from('learning_modules').insert({ subject_id: subjectData!.id, title: 'Imported Tests', description: 'Auto-imported tests' }).select('id').single();
        moduleData = newMod;
    }

    for (const cand of candidates) {
        // Upsert Employee
        const { data: empData, error: empErr } = await supabase.from('employees').upsert({
            employee_id: cand.empId,
            email: cand.email || `${cand.empId}@example.com`,
            full_name: cand.empName,
            role: cand.role || 'employee',
            is_first_login: false
        }, { onConflict: 'employee_id' }).select('id').single();

        if (empErr) {
            console.error(`Error upserting employee ${cand.empId}:`, empErr.message);
            continue;
        }

        const employeeUuid = empData.id;

        for (const bank of cand.matchedBanks) {
            // Upsert Topic
            let { data: topicData } = await supabase.from('learning_topics').select('id').eq('title', bank.original).maybeSingle();
            if (!topicData) {
                const { data: newTop, error: topErr } = await supabase.from('learning_topics').insert({
                    module_id: moduleData!.id,
                    title: bank.original,
                    description: `Questions for ${bank.original}`,
                    order_index: 0
                }).select('id').single();
                if (topErr) {
                     console.error(`Error inserting topic for ${bank.original}`, topErr.message);
                     continue;
                }
                topicData = newTop;
            }

            // Create Test
            const { data: testData, error: testErr } = await supabase.from('tests').insert({
                employee_id: cand.empId,
                topic_id: topicData!.id,
                title: `Assessment: ${bank.original}`
            }).select('id').single();

            if (testErr) {
                console.error(`Error creating test for ${cand.empId}:`, testErr.message);
                continue;
            }

            // Insert Test Questions
            const testQuestions = bank.questions.map((q: any, i: number) => ({
                test_id: testData.id,
                question_index: i,
                question_text: q.qText,
                options: q.options,
                correct_option_index: q.correctIndex,
                explanation: q.explanation,
                difficulty: q.difficulty,
                topic_id: topicData.id,
                topic_title: bank.original
            }));

            const { error: tqErr } = await supabase.from('test_questions').insert(testQuestions);
            if (tqErr) {
                console.error(`Error inserting test questions for ${cand.empId}:`, tqErr.message);
            }
        }
    }
    console.log('Finished DB syncing!');

    // 5. Generate Output Excel
    console.log('\\n5. Generating Summary Excel...');
    const outWorkbook = new ExcelJS.Workbook();
    
    const wsMappings = outWorkbook.addWorksheet('Candidate Mapping');
    wsMappings.addRow(['Emp ID', 'EmpName', 'Original Product', 'Mapped Product']);
    outputMappings.forEach(m => wsMappings.addRow([m.empId, m.empName, m.originalProduct, m.mappedProduct]));

    const wsCreds = outWorkbook.addWorksheet('Credentials');
    wsCreds.addRow(['Emp ID', 'EmpName', 'Generated Password']);
    outputCredentials.forEach(c => wsCreds.addRow([c.empId, c.empName, c.password]));

    const wsMissing = outWorkbook.addWorksheet('Missing Products');
    wsMissing.addRow(['Emp ID', 'EmpName', 'Original Product']);
    missingProducts.forEach(m => wsMissing.addRow([m.empId, m.empName, m.originalProduct]));

    await outWorkbook.xlsx.writeFile(OUTPUT_FILE);
    console.log(`Summary written to ${OUTPUT_FILE}`);
    console.log('\\n--- DONE ---');
}

run().catch(console.error);
