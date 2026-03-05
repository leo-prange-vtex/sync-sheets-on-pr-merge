const core = require('@actions/core');
const github = require('@actions/github');
const {google} = require('googleapis');
const fs = require('fs');
const path = require('path');

// Convert markdown to HTML for better Google Docs compatibility
function markdownToHtml(markdownText) {
  let html = markdownText
    // Headings
    .replace(/^### (.*?)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Lists
    .replace(/^\* (.*?)$/gm, '<li>$1</li>')
    .replace(/^\- (.*?)$/gm, '<li>$1</li>');
  
  return html;
}

// Convert HTML to Google Docs API requests 
function htmlToGoogleDocs(htmlText, startIndex = 1) {
  const requests = [];
  let currentIndex = startIndex;
  
  // Parse HTML and create appropriate requests
  const lines = htmlText.split('\n').filter(l => l.trim());
  
  for (const line of lines) {
    if (line.includes('<h1>')) {
      const text = line.replace(/<\/?h1>/g, '').trim();
      if (text) {
        requests.push({
          insertText: {location: {index: currentIndex}, text: text + '\n'}
        });
        const len = text.length;
        requests.push({
          updateParagraphStyle: {
            range: {startIndex: currentIndex, endIndex: currentIndex + len},
            paragraphStyle: {namedStyleType: 'HEADING_1'},
            fields: 'namedStyleType'
          }
        });
        currentIndex += len + 1;
      }
    } else if (line.includes('<h2>')) {
      const text = line.replace(/<\/?h2>/g, '').trim();
      if (text) {
        requests.push({
          insertText: {location: {index: currentIndex}, text: text + '\n'}
        });
        const len = text.length;
        requests.push({
          updateParagraphStyle: {
            range: {startIndex: currentIndex, endIndex: currentIndex + len},
            paragraphStyle: {namedStyleType: 'HEADING_2'},
            fields: 'namedStyleType'
          }
        });
        currentIndex += len + 1;
      }
    } else if (line.includes('<h3>')) {
      const text = line.replace(/<\/?h3>/g, '').trim();
      if (text) {
        requests.push({
          insertText: {location: {index: currentIndex}, text: text + '\n'}
        });
        const len = text.length;
        requests.push({
          updateParagraphStyle: {
            range: {startIndex: currentIndex, endIndex: currentIndex + len},
            paragraphStyle: {namedStyleType: 'HEADING_3'},
            fields: 'namedStyleType'
          }
        });
        currentIndex += len + 1;
      }
    } else if (line.includes('<li>')) {
      const text = line.replace(/<\/?li>/g, '').trim();
      if (text) {
        requests.push({
          insertText: {location: {index: currentIndex}, text: '• ' + text + '\n'}
        });
        currentIndex += text.length + 3;
      }
    } else {
      // Regular paragraph or formatted text
      const cleanText = line.replace(/<[^>]+>/g, '').trim();
      if (cleanText) {
        requests.push({
          insertText: {location: {index: currentIndex}, text: cleanText + '\n'}
        });
        currentIndex += cleanText.length + 1;
      }
    }
  }
  
  return {requests, currentIndex};
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
    core.info(`No files found under ${folderPath}; exiting.`);
    return [];
  }
}

// Sync Google Docs with markdown files from repository
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

    // First, fetch the document to see which tabs already exist
    core.info('Fetching document to check existing tabs...');
    const docInfo = await docs.documents.get({documentId: docId});
    
    const existingTabs = new Map(); // Map of tabTitle -> tabId
    
    if (docInfo.data.tabs && docInfo.data.tabs.length > 0) {
      for (const tab of docInfo.data.tabs) {
        const tabTitle = tab.tabProperties?.title;
        const tabId = tab.tabProperties?.tabId;
        // Ignore Untitled tab (default tab in every Google Doc)
        if (tabTitle && tabTitle !== 'Untitled' && tabId) {
          existingTabs.set(tabTitle, tabId);
        }
      }
      core.debug(`Existing tabs (excluding Untitled): ${Array.from(existingTabs.keys()).join(', ')}`);
    }

    // Create tabs only for files that don't already have a tab
    const createTabRequests = [];
    const tabsToCreate = [];
    const fileToTabMap = new Map(); // Map file path to tab name (without extension)

    for (const file of changedFiles) {
      // Extract tab name: remove path and extension
      const tabName = path.basename(file, path.extname(file));
      fileToTabMap.set(file, tabName);
      
      if (!existingTabs.has(tabName)) {
        tabsToCreate.push(tabName);
        createTabRequests.push({
          addDocumentTab: {
            tabProperties: {title: tabName}
          }
        });
        core.debug(`Queuing tab creation for "${tabName}" (from file: ${file})`);
      }
    }

    // Execute tab creation requests if needed
    if (createTabRequests.length > 0) {
      core.info(`Creating ${createTabRequests.length} new tabs: ${tabsToCreate.join(', ')}`);
      const createResponse = await docs.documents.batchUpdate({documentId: docId, requestBody: {requests: createTabRequests}});
      
      core.debug(`batchUpdate response: ${JSON.stringify(createResponse.data, null, 2)}`);
      
      // Extract created tab IDs from response
      if (createResponse.data.replies && createResponse.data.replies.length > 0) {
        core.debug(`Replies length: ${createResponse.data.replies.length}`);
        for (let i = 0; i < createResponse.data.replies.length; i++) {
          const reply = createResponse.data.replies[i];
          const tabName = tabsToCreate[i];
          
          core.debug(`Reply ${i}: ${JSON.stringify(reply, null, 2)}`);
          
          if (reply.addDocumentTab && reply.addDocumentTab.documentTab && reply.addDocumentTab.documentTab.tabId) {
            const tabId = reply.addDocumentTab.documentTab.tabId;
            existingTabs.set(tabName, tabId);
            core.debug(`Captured created tab "${tabName}" -> ${tabId}`);
          }
        }
      }
    }

    // Fetch the document again to get all tab IDs (existing + newly created)
    core.info('Fetching document to retrieve all tab IDs...');
    const updatedDocInfo = await docs.documents.get({documentId: docId});
    
    core.debug(`documents.get() response keys: ${Object.keys(updatedDocInfo.data).join(', ')}`);
    core.debug(`Has tabs property: ${!!updatedDocInfo.data.tabs}`);
    core.debug(`Tabs: ${JSON.stringify(updatedDocInfo.data.tabs, null, 2)}`);
    
    const tabIdMap = new Map(); // Map of tabName -> {tabId, title}
    // Get the list of expected tab names (already without extension)
    const expectedTabNames = Array.from(fileToTabMap.values());
    
    core.debug(`Expected tab names: ${expectedTabNames.join(', ')}`);
    
    if (updatedDocInfo.data.tabs && updatedDocInfo.data.tabs.length > 0) {
      core.debug(`Found ${updatedDocInfo.data.tabs.length} tabs in document`);
      
      for (const tab of updatedDocInfo.data.tabs) {
        const tabTitle = tab.tabProperties?.title;
        const tabId = tab.tabProperties?.tabId;
        
        core.debug(`Processing tab: "${tabTitle}" (ID: ${tabId})`);
        
        // Ignore Untitled tab
        if (tabTitle === 'Untitled') {
          core.debug(`Skipping Untitled tab: ${tabId}`);
          continue;
        }
        
        // Match tabs by title (exact match) - both are already without extension
        if (tabTitle && tabId && expectedTabNames.includes(tabTitle)) {
          tabIdMap.set(tabTitle, {tabId, title: tabTitle});
          core.debug(`Mapped tab "${tabTitle}" -> ${tabId}`);
        } else if (tabTitle && tabId) {
          core.debug(`Tab "${tabTitle}" does not match any file (expected: ${expectedTabNames.join(', ')})`);
        }
      }
      core.info(`Successfully mapped ${tabIdMap.size} of ${changedFiles.length} files to tabs`);
    } else {
      core.warning('No tabs found in document after fetch');
      core.debug(`Debugging info - updatedDocInfo.data type: ${typeof updatedDocInfo.data}, keys: ${Object.keys(updatedDocInfo.data).slice(0, 5).join(', ')}`);
    }
    
    // Fallback: use existingTabs if document fetch didn't return tabs (they might not be visible yet)
    if (tabIdMap.size === 0 && existingTabs.size > 0) {
      core.info(`Document fetch returned no matching tabs, using captured tab IDs from creation`);
      core.debug(`existingTabs has ${existingTabs.size} entries: ${Array.from(existingTabs.keys()).join(', ')}`);
      for (const [tabTitle, tabId] of existingTabs) {
        // Only use tabs that match our expected files
        if (expectedTabNames.includes(tabTitle)) {
          tabIdMap.set(tabTitle, {tabId, title: tabTitle});
          core.debug(`Using captured tab "${tabTitle}" -> ${tabId}`);
        }
      }
      core.debug(`After fallback, tabIdMap has ${tabIdMap.size} entries`);
    }

    // Now insert content into each tab
    for (const file of changedFiles) {
      // Get the tab name that was assigned to this file (without extension)
      const tabName = fileToTabMap.get(file);
      if (!tabName) {
        core.warning(`Internal error: no tab name mapped for file ${file}`);
        continue;
      }
      
      const tabInfo = tabIdMap.get(tabName);
      
      if (!tabInfo) {
        core.warning(`Could not find tab for file ${file} (expected tab name: "${tabName}")`);
        core.warning(`Available tabs: ${Array.from(tabIdMap.keys()).join(', ') || 'none'}`);
        continue;
      }

      const filePath = path.join(process.cwd(), file);
      let markdownContent = '';
      try {
        markdownContent = fs.readFileSync(filePath, 'utf8');
      } catch (e) {
        core.warning(`Error reading file ${file}: ${e.message}`);
        markdownContent = `Error reading file: ${e.message}`;
      }

      // Convert markdown to HTML then to Google Docs requests
      const htmlContent = markdownToHtml(markdownContent);
      const {requests: contentRequests} = htmlToGoogleDocs(htmlContent);
      
      if (contentRequests.length > 0) {
        // Add tab ID to all insertText requests
        const tabRequests = contentRequests.map(req => {
          if (req.insertText && req.insertText.location) {
            return {
              ...req,
              insertText: {
                ...req.insertText,
                location: {
                  ...req.insertText.location,
                  tabId: tabInfo.tabId
                }
              }
            };
          }
          if (req.updateParagraphStyle && req.updateParagraphStyle.range) {
            return {
              ...req,
              updateParagraphStyle: {
                ...req.updateParagraphStyle,
                range: {
                  ...req.updateParagraphStyle.range,
                  tabId: tabInfo.tabId
                }
              }
            };
          }
          return req;
        });
        
        try {
          await docs.documents.batchUpdate({
            documentId: docId,
            requestBody: {requests: tabRequests}
          });
          core.info(`Successfully synced file ${file} to tab ${tabName}`);
        } catch (e) {
          core.warning(`Failed to sync ${file}: ${e.message}`);
        }
      }
    }

    core.info('Google Doc updated successfully');
  } catch (error) {
    core.setFailed(error.message);
  }
}

// Export for testing
module.exports = {run};

// Run the action
run();
