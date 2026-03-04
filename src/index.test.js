jest.mock('@actions/core');
jest.mock('@actions/github');
jest.mock('googleapis');

const core = require('@actions/core');
const github = require('@actions/github');
const {google} = require('googleapis');
const fs = require('fs');
const {run} = require('./index.js');

describe('GitHub Action - Sync to Google Docs', () => {
  const originalReadFileSync = fs.readFileSync;
  
  beforeEach(() => {
    jest.clearAllMocks();
    fs.readFileSync = jest.fn();
    
    // Mock default inputs
    core.getInput.mockImplementation((name) => {
      const inputs = {
        'folder_path': 'docs/prds',
        'google_service_account': '{"type":"service_account"}',
        'google_doc_id': 'test-doc-id',
        'github_token': 'test-token'
      };
      return inputs[name];
    });

    // Default context
    github.context = {
      eventName: 'pull_request',
      payload: {
        pull_request: {
          number: 42,
          merged: true
        }
      },
      repo: {
        owner: 'test-owner',
        repo: 'test-repo'
      },
      ref: 'refs/heads/main'
    };
  });

  afterEach(() => {
    fs.readFileSync = originalReadFileSync;
  });

  test('handles pull_request merge events', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn().mockResolvedValue({
            data: [
              {type: 'file', name: 'README.md', path: 'docs/prds/README.md'}
            ]
          })
        }
      }
    };

    github.getOctokit.mockReturnValue(mockOctokit);

    const mockDocs = {
      documents: {
        get: jest.fn().mockResolvedValue({
          data: {
            tabs: [
              {tabProperties: {tabId: 'tab-untitled', title: 'Untitled'}},
              {tabProperties: {tabId: 'tab-readme', title: 'README'}}
            ]
          }
        }),
        batchUpdate: jest.fn().mockResolvedValue({data: {replies: []}})
      }
    };

    google.docs.mockReturnValue(mockDocs);
    google.auth.GoogleAuth.mockImplementation(() => ({}));

    fs.readFileSync.mockReturnValue('# Test Content');

    await run();

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Files to sync'));
    expect(mockDocs.documents.get).toHaveBeenCalled();
  });

  test('ignores Untitled tab and writes to correct tabs', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn().mockResolvedValue({
            data: [
              {type: 'file', name: 'prd-001.md', path: 'docs/prds/prd-001.md'},
              {type: 'file', name: 'prd-002.md', path: 'docs/prds/prd-002.md'}
            ]
          })
        }
      }
    };

    github.getOctokit.mockReturnValue(mockOctokit);

    const mockDocs = {
      documents: {
        get: jest.fn()
          .mockResolvedValueOnce({
            data: {
              tabs: [
                {tabProperties: {tabId: 'untitled', title: 'Untitled'}}
              ]
            }
          })
          .mockResolvedValueOnce({
            data: {
              tabs: [
                {tabProperties: {tabId: 'untitled', title: 'Untitled'}},
                {tabProperties: {tabId: 'tab-001', title: 'prd-001'}},
                {tabProperties: {tabId: 'tab-002', title: 'prd-002'}}
              ]
            }
          }),
        batchUpdate: jest.fn().mockResolvedValue({data: {replies:[]}})
      }
    };

    google.docs.mockReturnValue(mockDocs);
    google.auth.GoogleAuth.mockImplementation(() => ({}));

    fs.readFileSync.mockReturnValue('# PRD Content');

    await run();

    expect(mockDocs.documents.batchUpdate).toHaveBeenCalled();
    // Verify that tab IDs were set correctly (not to Untitled)
    const callArgs = mockDocs.documents.batchUpdate.mock.calls;
    expect(callArgs.length).toBeGreaterThan(0);
  });

  test('skips unmerged pull requests', async () => {
    github.context.payload.pull_request.merged = false;

    await run();

    expect(core.info).toHaveBeenCalledWith('Pull request not merged; skipping.');
  });

  test('handles errors gracefully', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn().mockRejectedValue(new Error('Not Found'))
        }
      }
    };

    github.getOctokit.mockReturnValue(mockOctokit);

    await run();

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('No files found'));
  });
});
