jest.mock('@actions/core');
jest.mock('@actions/github');
jest.mock('googleapis');

const core = require('@actions/core');
const github = require('@actions/github');
const {google} = require('googleapis');
const fs = require('fs');
const path = require('path');
const {run} = require('./index.js');

describe('GitHub Action - Sync to Google Docs', () => {
  const originalReadFileSync = fs.readFileSync;
  
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GITHUB_TOKEN = 'test-token';
    
    // Mock fs.readFileSync
    fs.readFileSync = jest.fn();
    
    // Mock default implementations
    core.getInput.mockImplementation((name) => {
      const inputs = {
        'folder_path': 'docs/prds',
        'google_service_account': '{"type":"service_account"}',
        'google_doc_id': 'test-doc-id',
        'github_token': 'test-token'
      };
      return inputs[name];
    });

    github.context = {
      payload: {
        pull_request: {
          number: 42,
          merged: true
        }
      },
      repo: {
        owner: 'test-owner',
        repo: 'test-repo'
      }
    };
  });

  afterEach(() => {
    fs.readFileSync = originalReadFileSync;
  });

  test('fails when pull_request event is missing', async () => {
    github.context.payload = {};

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      'This action should be triggered by a pull_request event'
    );
  });

  test('returns when PR is not merged', async () => {
    github.context.payload.pull_request.merged = false;

    await run();

    expect(core.info).toHaveBeenCalledWith('Pull request not merged; skipping.');
  });

  test('returns when no files changed in target folder', async () => {
    const mockOctokit = {
      rest: {
        pulls: {
          listFiles: jest.fn().mockResolvedValue({
            data: [
              {filename: 'README.md'},
              {filename: 'src/other.js'}
            ]
          })
        }
      }
    };

    github.getOctokit.mockReturnValue(mockOctokit);

    await run();

    expect(core.info).toHaveBeenCalledWith(
      'No files changed under docs/prds; exiting.'
    );
  });

  test('fails when GITHUB_TOKEN is not provided', async () => {
    core.getInput.mockImplementation((name) => {
      const inputs = {
        'folder_path': 'docs/prds',
        'google_service_account': '{"type":"service_account"}',
        'google_doc_id': 'test-doc-id',
        'github_token': ''  // Empty token to simulate missing input
      };
      return inputs[name];
    });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      'GITHUB_TOKEN not provided. This input is required to list PR files.'
    );
  });

  test('successfully syncs files to Google Doc', async () => {
    const mockOctokit = {
      rest: {
        pulls: {
          listFiles: jest.fn().mockResolvedValue({
            data: [
              {filename: 'docs/prds/prd-001.md'},
              {filename: 'docs/prds/prd-002.md'},
              {filename: 'README.md'}
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
            body: {
              content: [{endIndex: 100}]
            }
          }
        }),
        batchUpdate: jest.fn().mockResolvedValue({})
      }
    };

    google.docs.mockReturnValue(mockDocs);
    google.auth.GoogleAuth.mockImplementation(() => ({}));

    fs.readFileSync.mockImplementation((filePath) => {
      if (filePath.includes('prd-001.md')) return '# PRD 001';
      if (filePath.includes('prd-002.md')) return '# PRD 002';
      throw new Error('File not found');
    });

    await run();

    expect(core.info).toHaveBeenCalledWith('Files to sync: docs/prds/prd-001.md, docs/prds/prd-002.md');
    expect(core.info).toHaveBeenCalledWith('Google Doc updated successfully');
    expect(mockDocs.documents.batchUpdate).toHaveBeenCalled();
  });

  test('handles file read errors gracefully', async () => {
    const mockOctokit = {
      rest: {
        pulls: {
          listFiles: jest.fn().mockResolvedValue({
            data: [
              {filename: 'docs/prds/missing.md'}
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
            body: {
              content: [{endIndex: 100}]
            }
          }
        }),
        batchUpdate: jest.fn().mockResolvedValue({})
      }
    };

    google.docs.mockReturnValue(mockDocs);
    google.auth.GoogleAuth.mockImplementation(() => ({}));

    fs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    await run();

    expect(mockDocs.documents.batchUpdate).toHaveBeenCalled();
    const batchUpdateCall = mockDocs.documents.batchUpdate.mock.calls[0][0];
    expect(batchUpdateCall.requestBody.requests[0].insertText.text).toContain('failed to read');
  });

  test('handles Google API errors', async () => {
    const mockOctokit = {
      rest: {
        pulls: {
          listFiles: jest.fn().mockResolvedValue({
            data: [
              {filename: 'docs/prds/prd-001.md'}
            ]
          })
        }
      }
    };

    github.getOctokit.mockReturnValue(mockOctokit);

    const apiError = new Error('Google API Error: Invalid credentials');
    google.docs.mockImplementation(() => {
      throw apiError;
    });

    fs.readFileSync.mockReturnValue('test content');

    await run();

    expect(core.setFailed).toHaveBeenCalledWith('Google API Error: Invalid credentials');
  });

  test('correctly formats content before syncing', async () => {
    const mockOctokit = {
      rest: {
        pulls: {
          listFiles: jest.fn().mockResolvedValue({
            data: [
              {filename: 'docs/prds/prd-001.md'}
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
            body: {
              content: [{endIndex: 100}]
            }
          }
        }),
        batchUpdate: jest.fn().mockResolvedValue({})
      }
    };

    google.docs.mockReturnValue(mockDocs);
    google.auth.GoogleAuth.mockImplementation(() => ({}));

    fs.readFileSync.mockReturnValue('Test file content');

    await run();

    const batchUpdateCall = mockDocs.documents.batchUpdate.mock.calls[0][0];
    const insertedText = batchUpdateCall.requestBody.requests[0].insertText.text;

    expect(insertedText).toContain('Synced files from test-owner/test-repo PR #42');
    expect(insertedText).toContain('docs/prds/prd-001.md');
    expect(insertedText).toContain('Test file content');
  });

  test('parses service account JSON correctly', async () => {
    const mockOctokit = {
      rest: {
        pulls: {
          listFiles: jest.fn().mockResolvedValue({
            data: [
              {filename: 'docs/prds/prd-001.md'}
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
            body: {
              content: [{endIndex: 100}]
            }
          }
        }),
        batchUpdate: jest.fn().mockResolvedValue({})
      }
    };

    google.docs.mockReturnValue(mockDocs);
    google.auth.GoogleAuth.mockImplementation(() => ({}));

    fs.readFileSync.mockReturnValue('test content');

    await run();

    expect(google.auth.GoogleAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {type: 'service_account'},
        scopes: ['https://www.googleapis.com/auth/documents']
      })
    );
  });

  test('handles multiple files in target folder', async () => {
    const mockOctokit = {
      rest: {
        pulls: {
          listFiles: jest.fn().mockResolvedValue({
            data: [
              {filename: 'docs/prds/prd-001.md'},
              {filename: 'docs/prds/subfolder/prd-002.md'},
              {filename: 'docs/prds/prd-003.md'},
              {filename: 'test/file.js'}
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
            body: {
              content: [{endIndex: 100}]
            }
          }
        }),
        batchUpdate: jest.fn().mockResolvedValue({})
      }
    };

    google.docs.mockReturnValue(mockDocs);
    google.auth.GoogleAuth.mockImplementation(() => ({}));

    fs.readFileSync.mockReturnValue('content');

    await run();

    expect(core.info).toHaveBeenCalledWith(
      'Files to sync: docs/prds/prd-001.md, docs/prds/subfolder/prd-002.md, docs/prds/prd-003.md'
    );
  });
});
