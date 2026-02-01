/**
 * HI COWORKING - LANDING PAGE BACKEND
 * * 1. Run setup() once to create the necessary sheets and headers.
 * 2. Deploy as Web App -> Execute as Me -> Who has access: Anyone.
 * 3. Paste the URL into App.jsx.
 */

const SPREADSHEET_ID = 'REPLACE_WITH_YOUR_SPREADSHEET_ID'; // <--- PASTE YOUR SPREADSHEET ID HERE

// --- SETUP FUNCTION ---
function setup() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // 1. Setup Early Access Sheet
  let eaSheet = ss.getSheetByName('EarlyAccess');
  if (!eaSheet) {
    eaSheet = ss.insertSheet('EarlyAccess');
    // Added: Source, Version, InterestScore, Notes
    eaSheet.appendRow(['Timestamp', 'Name', 'Email', 'Interests', 'Message', 'Intent', 'Source', 'Version', 'Interest Score', 'Notes']);
    eaSheet.setFrozenRows(1);
  }

  // 2. Setup Survey Responses Sheet
  let surSheet = ss.getSheetByName('SurveyResponses');
  if (!surSheet) {
    surSheet = ss.insertSheet('SurveyResponses');
    // Generic headers for flexible questions
    surSheet.appendRow(['Timestamp', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Q10', 'Source', 'Version', 'Notes']);
    surSheet.setFrozenRows(1);
  }
}

// --- POST HANDLER ---
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    // Default metadata
    const source = data.source || 'coming-soon-v3';
    const version = data.submission_version || '1.0';
    
    if (data.type === 'early_access') {
      const sheet = ss.getSheetByName('EarlyAccess');
      const interests = Array.isArray(data.interests) ? data.interests.join(', ') : data.interests;
      
      // Calculate simple interest score
      // Base score: 1. Add 1 for each interest checked. Add 2 if message provided.
      let score = 1;
      if (Array.isArray(data.interests)) score += data.interests.length;
      if (data.message && data.message.length > 5) score += 2;
      
      sheet.appendRow([
        new Date(),
        data.name,
        data.email,
        interests,
        data.message,
        data.intent || 'Not specified', // New Intent field
        source,
        version,
        score,
        '' // Notes (blank for manual entry)
      ]);
      
    } else if (data.type === 'survey') {
      const sheet = ss.getSheetByName('SurveyResponses');
      const ans = data.answers || {};
      
      // Map answer IDs (1-10) to columns
      // Note: Arrays (multi-select) are joined with commas
      const row = [new Date()];
      for (let i = 1; i <= 10; i++) {
        let val = ans[i] || '';
        if (Array.isArray(val)) val = val.join(', ');
        row.push(val);
      }
      
      // Add metadata
      row.push(source);
      row.push(version);
      row.push(''); // Notes
      
      sheet.appendRow(row);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}