import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { parseDocument } from '@/lib/jd-to-br/parserService';
import { extractJdDetails } from '@/lib/jd-to-br/aiService';
import { authenticateAdminRequest } from '@/lib/employee-auth';

export const dynamic = 'force-dynamic';

function getGradeFromExperience(expStr: string | undefined | null): string {
  if (!expStr) return 'E2';
  
  // Extract numbers
  const numbers = expStr.match(/\d+(\.\d+)?/g);
  if (!numbers || numbers.length === 0) {
    return 'E2';
  }
  
  const years = parseFloat(numbers[0]);
  if (years >= 0 && years < 1) return 'E0';
  if (years >= 1 && years < 3) return 'E1';
  if (years >= 3 && years < 6) return 'E2';
  if (years >= 6 && years < 9) return 'E3';
  if (years >= 9 && years < 12) return 'E4';
  if (years >= 12) return 'E5/E6';
  
  return 'E2';
}

export async function POST(req: NextRequest) {
  if (!authenticateAdminRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log('[Serverless API] Received request to process JDs and Excel template...');
    
    // Parse multipart form data
    const formData = await req.formData();
    const jdsFiles = formData.getAll('jds') as File[];
    const templateFile = formData.get('template') as File;

    // Read optional custom per-JD starting IDs mapping
    const mappingStr = formData.get('jdReqIdsMapping') as string || '{}';
    let jdReqIdsMapping: { [filename: string]: string } = {};
    try {
      jdReqIdsMapping = JSON.parse(mappingStr);
      console.log('[Serverless API] Custom per-JD mapping payload loaded successfully:', jdReqIdsMapping);
    } catch (e) {
      console.error('[Serverless API] Failed to parse custom per-JD mapping payload, using default.');
    }
    let currentReqIdNum: number | null = null;
    let sequentialSuffix = '';

    if (!jdsFiles || jdsFiles.length === 0) {
      return NextResponse.json({ detail: 'Missing Job Description files (.jds)' }, { status: 400 });
    }
    if (!templateFile) {
      return NextResponse.json({ detail: 'Missing Excel template file' }, { status: 400 });
    }

    console.log(`[Serverless API] Processing ${jdsFiles.length} JD files and Excel: ${templateFile.name}`);

    // Load Excel template workbook
    const templateBuffer = Buffer.from(await templateFile.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(templateBuffer as any);

    // Identify target worksheet
    let targetSheetName = 'BR _Raw Data';
    let sheet = workbook.getWorksheet(targetSheetName);

    if (!sheet) {
      const candidates = ['Global TMH Demand an_21Oct_1715', 'BR _Raw Data', 'BR_Raw Data'];
      for (const name of candidates) {
        sheet = workbook.getWorksheet(name);
        if (sheet) {
          targetSheetName = name;
          break;
        }
      }
    }

    if (!sheet) {
      sheet = workbook.worksheets[0];
      targetSheetName = sheet.name;
    }

    console.log(`[Serverless API] Target worksheet selected: "${targetSheetName}"`);

    // Scan backwards to find the last row containing actual data
    let lastDataRow = 1;
    for (let r = sheet.rowCount; r >= 1; r--) {
      const row = sheet.getRow(r);
      let hasData = false;
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
          hasData = true;
        }
      });
      if (hasData) {
        lastDataRow = r;
        break;
      }
    }

    console.log(`[Serverless API] Last non-empty row index detected: ${lastDataRow}`);

    // Read column headers (Row 1)
    const headers: string[] = [];
    const headerRow = sheet.getRow(1);
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers[colNumber] = cell.value ? cell.value.toString().trim() : '';
    });

    // Process each JD file sequentially
    for (const jdFile of jdsFiles) {
      const filename = jdFile.name;
      console.log(`[Serverless API] Processing JD file: ${filename}`);

      // Read file buffer
      const jdBuffer = Buffer.from(await jdFile.arrayBuffer());

      // Parse document text (supports DOCX and PDF)
      const rawText = await parseDocument(filename, jdBuffer);
      if (!rawText.trim()) {
        console.warn(`[Serverless API] Skipping empty JD file: ${filename}`);
        continue;
      }

      // Extract details (Structured OpenAI prompt with dynamic regex fallback)
      const jdDetails = await extractJdDetails(rawText, filename);

      // Determine template cell and new row indices
      const templateRowIndex = lastDataRow >= 2 ? lastDataRow : 2;
      const templateRow = sheet.getRow(templateRowIndex);
      const newRowIndex = lastDataRow + 1;
      const newRow = sheet.getRow(newRowIndex);

      console.log(`[Serverless API] Appending row at index ${newRowIndex}. Base template index: ${templateRowIndex}`);

      // Calculate sequential requirement ID auto-increment
      let newAutoReqId = '';
      const customIdForThisFile = jdReqIdsMapping[filename] || '';
      
      if (customIdForThisFile) {
        newAutoReqId = customIdForThisFile;
        console.log(`[Serverless API] Using file-specific custom Auto Req ID: ${newAutoReqId}`);
        // Seed the sequence for any subsequent empty fields
        if (/^\d+$/.test(customIdForThisFile)) {
          currentReqIdNum = parseInt(customIdForThisFile, 10) + 1;
          sequentialSuffix = ''; // User entered purely digit custom ID without BR, so sequential ones don't have BR
        } else {
          currentReqIdNum = null;
        }
      } else if (currentReqIdNum !== null) {
        newAutoReqId = `${currentReqIdNum}${sequentialSuffix}`;
        currentReqIdNum++; // Increment for subsequent JDs in the batch
      } else {
        try {
          const idIndex = headers.indexOf('Auto req ID');
          if (idIndex !== -1) {
            const lastIdVal = templateRow.getCell(idIndex).value;
            if (lastIdVal && typeof lastIdVal === 'string') {
              if (lastIdVal.endsWith('BR')) {
                const numPart = parseInt(lastIdVal.replace('BR', ''), 10);
                if (!isNaN(numPart)) {
                  newAutoReqId = `${numPart + 1}BR`;
                  currentReqIdNum = numPart + 2;
                  sequentialSuffix = 'BR';
                }
              } else {
                const numPart = parseInt(lastIdVal, 10);
                if (!isNaN(numPart)) {
                  newAutoReqId = `${numPart + 1}`;
                  currentReqIdNum = numPart + 2;
                  sequentialSuffix = '';
                }
              }
            }
          }
        } catch (err: any) {
          console.warn('[Serverless API] Auto Req ID increment failed, falling back to random ID:', err.message);
        }

        if (!newAutoReqId) {
          newAutoReqId = `${Math.floor(40000 + Math.random() * 9999)}`;
          currentReqIdNum = parseInt(newAutoReqId, 10) + 1;
          sequentialSuffix = '';
        }
      }

      // Conjoin skills list
      const allSkills = [
        ...(jdDetails.skills || []),
        ...(jdDetails.monitoring_tools || []),
        ...(jdDetails.cloud_platforms || [])
      ];
      const uniqueSkills = [...new Set(allSkills)].join(', ');

      const currentDateString = new Date().toISOString().split('T')[0];

      // Map Grade according to experience using helper function
      const calculatedGrade = getGradeFromExperience(jdDetails.experience);
      console.log(`[Serverless API] Mapped experience "${jdDetails.experience}" to Grade: "${calculatedGrade}"`);

      // Map values to columns
      const fieldMapping: { [key: string]: any } = {
        'Auto req ID': newAutoReqId,
        'Current Req Status': 'Open',
        'Grade': calculatedGrade,
        'Designation': jdDetails.job_title,
        'Recruiter': '',
        'Department Type': 'Technical',
        'BU': 'ITS - TMH - Delivery',
        'Client Interview?': 'Yes',
        'Mandatory Skills': uniqueSkills,
        'Entity': 'OFFSHORE',
        'Client Name': 'IRON MOUNTAIN',
        'Billing Type': 'Billable',
        'Project': 'IM DXP-IDP 2025',
        'Requester ID': '1026374',
        'TAG Manager': 'Antony, Nithin (1027544)',
        'RM Name': 'Hippargi, Anil (1017237)',
        'Job description': rawText.substring(0, 5000),
        'Joining Location': 'Bangalore - Global Axis',
        'Backfill for Employee Name': '',
        'Date Approved': currentDateString,
        'No. of Positions': 1,
        'Positions Remaining': 1,
        'Sourcing Type': 'External - India',
        'Requirement Type': 'New',
        'ST (Bill Rate) Enter only numeric value and 0 for Non-Billable': 5.5
      };

      // Set cell values and copy cell-level styles from template row
      for (let c = 1; c < headers.length; c++) {
        const headerName = headers[c];
        if (!headerName) continue;

        const newCell = newRow.getCell(c);
        const templateCell = templateRow.getCell(c);

        if (headerName in fieldMapping) {
          newCell.value = fieldMapping[headerName];
        } else {
          newCell.value = '';
        }

        // Deep-copy template cell formatting to new row
        if (templateCell) {
          newCell.font = templateCell.font ? JSON.parse(JSON.stringify(templateCell.font)) : undefined;
          newCell.fill = templateCell.fill ? JSON.parse(JSON.stringify(templateCell.fill)) : undefined;
          newCell.border = templateCell.border ? JSON.parse(JSON.stringify(templateCell.border)) : undefined;
          newCell.alignment = templateCell.alignment ? JSON.parse(JSON.stringify(templateCell.alignment)) : undefined;
          newCell.numFmt = templateCell.numFmt;
        }
      }

      newRow.commit();
      
      // Update lastDataRow index so next JD appends sequentially
      lastDataRow = newRowIndex;
    }

    // Write final output workbook to buffer
    const finalBuffer = await workbook.xlsx.writeBuffer();
    console.log('[Serverless API] Generated workbook buffer successfully!');

    // Stream updated spreadsheet back to browser
    return new Response(finalBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="updated_${templateFile.name}"`,
      },
    });

  } catch (err: any) {
    console.error('[Serverless API] Error processing uploads:', err.message);
    return NextResponse.json({ detail: `Spreadsheet processing error: ${err.message}` }, { status: 500 });
  }
}
