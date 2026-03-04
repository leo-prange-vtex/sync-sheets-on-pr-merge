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
    
    // Mock fs.readFileSync
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

    // Default context for pull_request event
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

  test('handles push events', async () => {
    github.context.eventName = 'push';
    
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
        get: jest.fn().mockResolvedValue({
          data: {
            tabs: [
              {tabProperties: {tabId: 'tab-001', title: 'prd-001'}},
              {tabProperties: {tabId: 'tab-002', title: 'prd-002'}}
            ]
          }
        }),
        batchUpdate: jest.fn().mockResolvedValue({
          data: {
            replies: [
              {addDocumentTab: {documentTab: {tabId: 'tab-001'}}},
              {addDocumentTab: {documentTab: {tabId: 'tab-002'}}}
            ]
          }
        })
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

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Files to sync'));
    expect(mockDocs.documents.get).toHaveBeenCalled();
  });

  test('handles pull_request merge events', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn().mockResolvedValue({
            data: [
              {type: 'file', name: 'prd-001.md', path: 'docs/prds/prd-001.md'}
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
              {tabProperties: {tabId: 'tab-001', title: 'prd-001'}}
            ]
          }
        }),
        batchUpdate: jest.fn().mockResolvedValue({
          data: {
            replies: [{addDocumentTab: {documentTab: {tabId: 'tab-001'}}}]
          }
        })
      }
    };

    google.docs.mockReturnValue(mockDocs);
    google.auth.GoogleAuth.mockImplementation(() => ({}));

    fs.readFileSync.mockReturnValue('# Test');

    await run();

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Files to sync'));
  });

  test('skips unmerged pull requests', async () => {
    github.context.payload.pull_request.merged = false;

    await run();

    expect(core.info).toHaveBeenCalledWith('Pull request not merged; skipping.');
  });

  test('fails when GITHUB_TOKEN is not provided', async () => {
    core.getInput.mockImplementation((name) => {
      const inputs = {
        'folder_path': 'docs/prds',
        'google_service_account': '{"type":"service_account"}',
        'google_doc_id': 'test-doc-id',
        'github_token': ''
      };
      return inputs[name];
    });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('GITHUB_TOKEN not provided')
    );
  });

  test('creates tabs for multiple files', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn().mockResolvedValue({
            data: [
              {type: 'file', name: 'prd-001.md', path: 'docs/prds/prd-001.md'},
              {type: 'file', name: 'prd-002.md', path: 'docs/prds/prd-002.md'},
              {type: 'file', name: 'prd-003.md', path: 'docs/prds/prd-003.md'}
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
              {tabProperties: {tabId: 'tab-001', title: 'prd-001'}},
              {tabProperties: {tabId: 'tab-002', title: 'prd-002'}},
              {tabProperties: {tabId: 'tab-003', title: 'prd-003'}}
            ]
          }
        }),
        batchUpdate: jest.fn().mockResolvedValue({
          data: {
            replies: [
              {addDocumentTab: {documentTab: {tabId: 'tab-001'}}},
              {addDocumentTab: {documentTab: {tabId: 'tab-002'}}},
              {addDocumentTab: {documentTab: {tabId: 'tab-003'}}}
            ]
          }
        })
      }
    };

    google.docs.mockReturnValue(mockDocs);
    google.auth.GoogleAuth.mockImplementation(() => ({}));

    fs.readFileSync.mockReturnValue('content');

    await run();

    expect(mockDocs.documents.get).toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Found 3 tabs to fill with content'));
  });

  test('handles non-existent folder gracefully', async () => {
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

  test('handles unsupported events', async () => {
    github.context.eventName = 'issues';

    await run();

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('not supported'));
  });

  test('processes markdown formatting', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn().mockResolvedValue({
            data: [
              {type: 'file', name: 'prd-001.md', path: 'docs/prds/prd-001.md'}
            ]
          })
        }
      }
    };

    github.getOctokit.mockReturnValue(mockOctokit);

    const mockDocs = {
      documents: {
        batchUpdate: jest.fn().mockResolvedValue({
          data: {
            replies: [{addDocumentTab: {documentTab: {tabId: 'tab-001'}}}]
          }
        }),
        get: jest.fn().mockResolvedValue({
          data: {
            tabs: [
              {tabProperties: {tabId: 'tab-001', title: 'prd-001'}}
            ]
          }
        })
      }
    };

    google.docs.mockReturnValue(mockDocs);
    google.auth.GoogleAuth.mockImplementation(() => ({}));

    const markdownContent = '# Heading\\n\\nSome **bold** text';
    fs.readFileSync.mockReturnValue(markdownContent);

    await run();

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('successfully'));
    expect(mockDocs.documents.batchUpdate).toHaveBeenCalled();
  });

  test('handles file read errors', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn().mockResolvedValue({
            data: [
              {type: 'file', name: 'prd-001.md', path: 'docs/prds/prd-001.md'}
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
              {tabProperties: {tabId: 'tab-001', title: 'prd-001'}}
            ]
          }
        }),
        batchUpdate: jest.fn().mockResolvedValue({
          data: {
            replies: [{addDocumentTab: {documentTab: {tabId: 'tab-001'}}}]
          }
        })
      }
    };

    google.docs.mockReturnValue(mockDocs);
    google.auth.GoogleAuth.mockImplementation(() => ({}));

    fs.readFileSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    await run();

    expect(mockDocs.documents.get).toHaveBeenCalled();
  });

});
