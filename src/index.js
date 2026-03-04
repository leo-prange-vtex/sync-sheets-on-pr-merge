const core = require('@actions/core');
const github = require('@actions/github');
const {google} = require('googleapis');
const fs = require('fs');
const path = require('path');

async function run() {
  try {
    const folderPath = core.getInput('folder_path', {required: true});
    const serviceAccount = core.getInput('google_service_account', {required: true});
    const docId = core.getInput('google_doc_id', {required: true});
    const token = core.getInput('github_token');

    const context = github.context;

    if (!context.payload.pull_request) {
      core.setFailed('This action should be triggered by a pull_request event');
      return;
    }

    if (!context.payload.pull_request.merged) {
      core.info('Pull request not merged; skipping.');
      return;
    }

    // Use provided token or fail if not available
    if (!token) {
      core.setFailed('GITHUB_TOKEN not provided. This input is required to list PR files.');
      return;
    }

    const octokit = github.getOctokit(token);
    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const prNumber = context.payload.pull_request.number;

    const filesResp = await octokit.rest.pulls.listFiles({owner, repo, pull_number: prNumber});
    const changedFiles = filesResp.data.map(f => f.filename).filter(f => f.startsWith(folderPath));

    if (changedFiles.length === 0) {
      core.info(`No files changed under ${folderPath}; exiting.`);
      return;
    }

    core.info(`Files to sync: ${changedFiles.join(', ')}`);

    // Authenticate with service account
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(serviceAccount),
      scopes: ['https://www.googleapis.com/auth/documents']
    });

    const docs = google.docs({version: 'v1', auth});

    // For simplicity, create or overwrite a named "tab" by writing content to the doc as a header + files list
    let content = `Synced files from ${owner}/${repo} PR #${prNumber}\n\n`;

    for (const file of changedFiles) {
      const filePath = path.join(process.cwd(), file);
      let text = '';
      try {
        text = fs.readFileSync(filePath, 'utf8');
      } catch (e) {
        text = `(failed to read ${filePath}: ${e.message})`;
      }
      content += `=== ${file} ===\n${text}\n\n`;
    }

    // Replace document body with content
    // Append new content to the document
    const requests = [
      {insertText: {location: {index: 1}, text: `\n${content}`}}
    ];

    await docs.documents.batchUpdate({documentId: docId, requestBody: {requests}});

    core.info('Google Doc updated successfully');

  } catch (error) {
    core.setFailed(error.message);
  }
}

// Export for testing
module.exports = {run};

// Run if this is the main module
if (require.main === module) {
  run().catch(err => core.setFailed(err.message));
}
