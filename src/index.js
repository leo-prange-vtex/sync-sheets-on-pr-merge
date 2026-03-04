const core = require('@actions/core');
const github = require('@actions/github');
const {google} = require('googleapis');
const fs = require('fs');
const path = require('path');

// Simple markdown to Google Docs conversion - handles basic formatting
function markdownToGoogleDocs(markdownText) {
  const requests = [];
  let currentIndex = 1;
  
  // Split by lines and process
  const lines = markdownText.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (!line.trim()) {
      // Empty line
      requests.push({
        insertText: {
          location: {index: currentIndex},
          text: '\n'
        }
      });
      currentIndex += 1;
    } else if (line.startsWith('#')) {
      // Heading
      const match = line.match(/^(#+)\s+(.*)/);
      if (match) {
        const level = match[1].length;
        const text = match[2];
        
        requests.push({
          insertText: {
            location: {index: currentIndex},
            text: text + '\n'
          }
        });
        
        const headingType = `HEADING_${Math.min(level, 6)}`;
        requests.push({
          updateParagraphStyle: {
            range: {startIndex: currentIndex, endIndex: currentIndex + text.length},
            paragraphStyle: {namedStyleType: headingType},
            fields: 'namedStyleType'
          }
        });
        
        currentIndex += text.length + 1;
      }
    } else if (line.startsWith('-') || line.startsWith('*')) {
      // List item
      const match = line.match(/^[-*]\s+(.*)/);
      if (match) {
        const text = match[1];
        requests.push({
          insertText: {
            location: {index: currentIndex},
            text: text + '\n'
          }
        });
        currentIndex += text.length + 1;
      }
    } else {
      // Regular paragraph
      requests.push({
        insertText: {
          location: {index: currentIndex},
          text: line + '\n'
        }
      });
      
      // Apply bold formatting for **text**
      const boldMatches = [...line.matchAll(/\*\*(.+?)\*\*/g)];
      for (const match of boldMatches) {
        const boldText = match[1];
        const startPos = line.indexOf(match[0]);
        if (startPos >= 0) {
          requests.push({
            updateTextStyle: {
              range: {
                startIndex: currentIndex + startPos,
                endIndex: currentIndex + startPos + boldText.length
              },
              textStyle: {bold: true},
              fields: 'bold'
            }
          });
        }
      }
      
      // Apply italic formatting for *text*
      const italicMatches = [...line.matchAll(/\*(.+?)\*/g)];
      for (const match of italicMatches) {
        const italicText = match[1];
        const startPos = line.indexOf(match[0]);
        if (startPos >= 0) {
          requests.push({
            updateTextStyle: {
              range: {
                startIndex: currentIndex + startPos,
                endIndex: currentIndex + startPos + italicText.length
              },
              textStyle: {italic: true},
              fields: 'italic'
            }
          });
        }
      }
      
      currentIndex += line.length + 1;
    }
  }
  
  return requests;
}

async function run() {
  try {
    const folderPath = core.getInput('folder_path', {required: true});
    const serviceAccount = core.getInput('google_service_account', {required: true});
    const docId = core.getInput('google_doc_id', {required: true});
    const token = core.getInput('github_token');

    const context = github.context;
    let changedFiles = [];

    // Handle push event
    if (context.eventName === 'push') {
      // List all files in folder from the repository
      changedFiles = await getAllFilesInFolder(folderPath, token, context);
    }
    // Handle pull_request event
    else if (context.eventName === 'pull_request') {
      if (!context.payload.pull_request) {
        core.setFailed('This action should be triggered by a pull_request event');
        return;
      }

      if (!context.payload.pull_request.merged) {
        core.info('Pull request not merged; skipping.');
        return;
      }

      // List all files in folder (not just changed ones)
      changedFiles = await getAllFilesInFolder(folderPath, token, context);
    } else {
      core.info(`Event '${context.eventName}' is not supported. Use 'push' or 'pull_request' events.`);
      return;
    }

    // Use provided token or fail if not available
    if (!token) {
      core.setFailed('GITHUB_TOKEN not provided. This input is required to list PR files.');
      return;
    }

    if (changedFiles.length === 0) {
      core.info(`No files found under ${folderPath}; exiting.`);
      return;
    }

    core.info(`Files to sync: ${changedFiles.join(', ')}`);

    // Authenticate with service account
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(serviceAccount),
      scopes: ['https://www.googleapis.com/auth/documents']
    });

    const docs = google.docs({version: 'v1', auth});
    const octokit = github.getOctokit(token);
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    // First, fetch the document to see which tabs already exist
    core.info('Fetching document to check existing tabs...');
    const docInfo = await docs.documents.get({documentId: docId});
    
    const existingTabTitles = new Set();
    if (docInfo.data.tabs && docInfo.data.tabs.length > 0) {
      for (const tab of docInfo.data.tabs) {
        const tabTitle = tab.tabProperties?.title;
        if (tabTitle) {
          existingTabTitles.add(tabTitle);
        }
      }
      core.debug(`Existing tabs: ${Array.from(existingTabTitles).join(', ')}`);
    }

    // Create tabs only for files that don't already have a tab
    const requests = [];
    const tabIds = [];
    const tabsToCreate = [];

    for (const file of changedFiles) {
      const tabName = path.basename(file, path.extname(file));
      if (!existingTabTitles.has(tabName)) {
        tabsToCreate.push(tabName);
        requests.push({
          addDocumentTab: {
            tabProperties: {title: tabName}
          }
        });
      }
    }

    // Execute tab creation requests if needed
    if (requests.length > 0) {
      core.info(`Creating ${requests.length} new tabs: ${tabsToCreate.join(', ')}`);
      const tabResponse = await docs.documents.batchUpdate({documentId: docId, requestBody: {requests: requests}});
      core.debug(`Tab creation response: ${JSON.stringify(tabResponse.data.replies)}`);
    }

    // Fetch the document again to get all tab IDs (existing + newly created)
    core.info('Fetching document to retrieve all tab IDs...');
    const updatedDocInfo = await docs.documents.get({documentId: docId});
    
    if (updatedDocInfo.data.tabs && updatedDocInfo.data.tabs.length > 0) {
      // Find tabs that match our files (by title and get their IDs)
      const fileTabTitles = changedFiles.map(f => path.basename(f, path.extname(f)));
      
      for (const tab of updatedDocInfo.data.tabs) {
        const tabTitle = tab.tabProperties?.title;
        if (tabTitle && fileTabTitles.includes(tabTitle)) {
          tabIds.push(tab.tabProperties.tabId);
        }
      }
      core.info(`Found ${tabIds.length} tabs to fill with content (IDs: ${JSON.stringify(tabIds)})`);
    }

    // If we got some but not all tabs, warn but continue
    if (tabIds.length > 0 && tabIds.length < changedFiles.length) {
      core.warning(`Only created ${tabIds.length} out of ${changedFiles.length} tabs`);
    }

    // If we couldn't create any tabs, insert to body instead
    if (tabIds.length === 0) {
      core.warning('Could not create tabs, inserting all content to document body');
      let content = 'Synced files:\n\n';

      for (const file of changedFiles) {
        const filePath = path.join(process.cwd(), file);
        let markdownContent = '';
        try {
          markdownContent = fs.readFileSync(filePath, 'utf8');
        } catch (e) {
          markdownContent = `Error reading file: ${e.message}`;
        }

        content += `\n--- ${path.basename(file)} ---\n${markdownContent}\n`;
      }

      const bodyRequests = [{
        insertText: {
          endOfSegmentLocation: {segmentId: ''},
          text: content
        }
      }];

      await docs.documents.batchUpdate({documentId: docId, requestBody: {requests: bodyRequests}});
      core.info('Google Doc updated successfully');
      return;
    }

    // Now add content to each tab
    const contentRequests = [];
    for (let i = 0; i < changedFiles.length; i++) {
      const file = changedFiles[i];
      const tabId = tabIds[i];
      
      if (!tabId) {
        core.warning(`Tab ${i} could not be created, skipping content for ${file}`);
        continue;
      }
      
      const filePath = path.join(process.cwd(), file);
      let markdownContent = '';
      try {
        markdownContent = fs.readFileSync(filePath, 'utf8');
      } catch (e) {
        markdownContent = `Error reading file: ${e.message}`;
      }

      // Convert markdown to Google Docs requests
      const mdRequests = markdownToGoogleDocs(markdownContent);
      
      // Adjust requests for this tab
      for (const req of mdRequests) {
        if (req.insertText) {
          req.insertText.location.tabId = tabId;
        } else if (req.updateParagraphStyle) {
          req.updateParagraphStyle.range.tabId = tabId;
        } else if (req.updateTextStyle) {
          req.updateTextStyle.range.tabId = tabId;
        } else if (req.createParagraphBullets) {
          req.createParagraphBullets.range.tabId = tabId;
        }
        contentRequests.push(req);
      }
    }

    // Insert formatted content into tabs
    if (contentRequests.length > 0) {
      await docs.documents.batchUpdate({documentId: docId, requestBody: {requests: contentRequests}});
    }

    core.info('Google Doc updated successfully with formatted Markdown content');

  } catch (error) {
    core.setFailed(error.message);
  }
}

// Helper function to get all files in a folder from GitHub
async function getAllFilesInFolder(folderPath, token, context) {
  const octokit = github.getOctokit(token);
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const ref = context.ref; // branch or commit ref

  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: folderPath,
      ref
    });

    if (!Array.isArray(response.data)) {
      return []; // Not a directory
    }

    // Filter for markdown files
    const files = response.data
      .filter(item => item.type === 'file' && item.name.endsWith('.md'))
      .map(item => item.path);

    return files;
  } catch (error) {
    core.warning(`Could not list files in folder '${folderPath}': ${error.message}`);
    return [];
  }
}

// Export for testing
module.exports = {run};

// Run if this is the main module
if (require.main === module) {
  run().catch(err => core.setFailed(err.message));
}
