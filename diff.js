const conflictResolution = require('./conflict_resolution');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const url = require('url');
const os = require('os');
require('dotenv').config({
    path: path.join(__dirname, '..', '.env')
});
const util = require('util');
const execPromise = util.promisify(exec);

// --- CONFIGURATION ---
const MAPPING_FILE = path.join(os.homedir(), '.ticket_mapping.json');
const RELEASE_FILE = path.join(os.homedir(), '.release_history.json');
const AVAILABILITY_FILE = path.join(os.homedir(), '.available_cherrypick_commits.json');
const ADO_CONFIG = {
    orgUrl: process.env.ADO_ORG_URL,
    project: process.env.ADO_PROJECT,
    token: process.env.ADO_TOKEN
};

function analyzeDependencyRisks(selectedHashes, targetBranch, sourceBranch) {
    const rawCommits = getCommits(sourceBranch); 
    const uniqueHashesSet = getUniqueHashesByContent(targetBranch, sourceBranch);
    
    let allCandidates = rawCommits.filter(c => uniqueHashesSet.has(c.hash));
    
    allCandidates.sort((a, b) => new Date(a.date) - new Date(b.date));

    const selectedSet = new Set(selectedHashes);
    const skippedFileMap = new Map();
    const risks = [];

    for (const commit of allCandidates) {
        const files = getCommitFiles(commit.hash);

        if (!selectedSet.has(commit.hash)) {
            files.forEach(file => {
                skippedFileMap.set(file, {
                    hash: commit.hash,
                    msg: commit.message,
                    date: commit.date
                });
            });
        } else {
            files.forEach(file => {
                if (skippedFileMap.has(file)) {
                    const conflict = skippedFileMap.get(file);
                    risks.push({
                        type: 'dependency_warning',
                        file: file,
                        pickedCommit: commit.hash,
                        skippedCommit: conflict.hash,
                        skippedMessage: conflict.msg,
                        severity: 'high'
                    });
                }
            });
        }
    }

    return risks;
}

async function getPullRequests(targetBranch) {
    try {
        const { orgUrl, project } = ADO_CONFIG;
        const repoId = process.env.ADO_REPO_ID;

        // apiPath starts from the project level
        const apiPath = `/${project}/_apis/git/repositories/${repoId}/pullrequests?searchCriteria.status=all&searchCriteria.targetRefName=refs/heads/${targetBranch}&api-version=7.0`;

        const response = await adoRequest(apiPath);
        
        if (!response.value) return [];
        
        return response.value.map(pr => ({
            id: pr.pullRequestId,
            title: pr.title,
            author: pr.createdBy.displayName,
            authorEmail: pr.createdBy.uniqueName,
            sourceBranch: pr.sourceRefName.replace('refs/heads/', ''),
            targetBranch: pr.targetRefName.replace('refs/heads/', ''),
            status: pr.status,
            createdDate: pr.creationDate,
            closedDate: pr.closedDate,
            mergeStatus: pr.mergeStatus,
            url: `${orgUrl}/${project}/_git/${repoId}/pullrequest/${pr.pullRequestId}`
        }));
    } catch (error) {
        console.error('Error fetching Azure DevOps PRs:', error.message);
        return [];
    }
}

async function killPort(port) {
    try {
        const platform = process.platform;
        
        if (platform === 'win32') {
            // Windows
            const { stdout } = await execPromise(`netstat -ano | findstr :${port}`);
            const lines = stdout.trim().split('\n');
            
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && !isNaN(pid)) {
                    await execPromise(`taskkill /PID ${pid} /F`);
                    console.log(`✅ Killed process ${pid} on port ${port}`);
                }
            }
        } else {
            // macOS and Linux
            try {
                const { stdout } = await execPromise(`lsof -ti:${port}`);
                const pids = stdout.trim().split('\n').filter(Boolean);
                
                for (const pid of pids) {
                    await execPromise(`kill -9 ${pid}`);
                    console.log(`✅ Killed process ${pid} on port ${port}`);
                }
            } catch (err) {
                // No process found on this port
                console.log(`ℹ️  No process found on port ${port}`);
            }
        }
    } catch (error) {
        console.log(`ℹ️  No process to kill on port ${port}`);
    }
}

function openBrowser(url) {
    const platform = process.platform;
    let command;
    
    if (platform === 'win32') {
        command = `start ${url}`;
    } else if (platform === 'darwin') {
        command = `open ${url}`;
    } else {
        command = `xdg-open ${url}`;
    }
    
    exec(command, (err) => {
        if (err) {
            console.log('⚠️  Could not open browser automatically');
        } else {
            console.log('🌐 Browser opened automatically');
        }
    });
}

// --- HELPER FUNCTIONS: FILE SYSTEM ---
function loadMapping() {
    if (!fs.existsSync(MAPPING_FILE)) return {};
    try {
        const data = fs.readFileSync(MAPPING_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error("Error reading mapping file:", e);
        return {};
    }
}

function saveMapping(data) {
    try {
        fs.writeFileSync(MAPPING_FILE, JSON.stringify(data, null, 2));
        console.log(`Saved mapping to ${MAPPING_FILE}`);
        return true;
    } catch (e) {
        console.error("Error saving mapping file:", e);
        return false;
    }
}

function loadReleases() {
    if (!fs.existsSync(RELEASE_FILE)) return {};
    try {
        const data = fs.readFileSync(RELEASE_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error("Error reading release file:", e);
        return {};
    }
}

function saveReleases(data) {
    try {
        fs.writeFileSync(RELEASE_FILE, JSON.stringify(data, null, 2));
        console.log(`Saved releases to ${RELEASE_FILE}`);
        return true;
    } catch (e) {
        console.error("Error saving release file:", e);
        return false;
    }
}

// NEW: Availability Helpers
function loadAvailability() {
    if (!fs.existsSync(AVAILABILITY_FILE)) return {};
    try {
        const data = fs.readFileSync(AVAILABILITY_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error("Error reading availability file:", e);
        return {};
    }
}

function saveAvailability(data) {
    try {
        fs.writeFileSync(AVAILABILITY_FILE, JSON.stringify(data, null, 2));
        console.log(`Saved availability to ${AVAILABILITY_FILE}`);
        return true;
    } catch (e) {
        console.error("Error saving availability file:", e);
        return false;
    }
}

// --- HELPER FUNCTIONS: GIT ---
function getCommits(branch) {
    try {
        const cmd = `git log ${branch} --pretty=format:"%H|||%s|||%an|||%ae|||%ad" --date=iso`;
        const output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 });
        if (!output.trim()) return [];
        return output.trim().split('\n').map(line => {
            const parts = line.split('|||');
            if (parts.length < 5) return null;
            const [hash, message, author, email, date] = parts;
            return { hash, message: message.trim(), author, email, date };
        }).filter(Boolean);
    } catch (error) { return []; }
}

function getCommitFiles(hash) {
    try {
        const cmd = `git show --name-only --pretty="" ${hash}`;
        return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
    } catch (error) { return []; }
}

function getSpecificFilesDiff(hash, targetBranch, fileList) {
    try {
        if (!fileList || fileList.length === 0) return '';
        const filesArg = fileList.map(f => `"${f}"`).join(' ');
        return execSync(`git diff ${targetBranch} ${hash} -- ${filesArg}`, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 20 });
    } catch (error) { return ''; }
}

function hasCodeChanges(hash) {
    try {
        return execSync(`git show ${hash} --format="" --patch --stat`, { encoding: 'utf-8' }).trim().length > 0;
    } catch (error) { return false; }
}

function getUniqueHashesByContent(upstream, head) {
    try {
        const output = execSync(`git cherry ${upstream} ${head}`, { encoding: 'utf-8' });
        const uniqueHashes = new Set();
        output.trim().split('\n').forEach(line => {
            const [sign, hash] = line.trim().split(' ');
            if (sign === '+') uniqueHashes.add(hash);
        });
        return uniqueHashes;
    } catch (error) { return new Set(); }
}

// --- HELPER FUNCTIONS: ADO API ---

function adoRequest(apiPath, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const authHeader = 'Basic ' + ADO_CONFIG.token;

        const options = {
            hostname: ADO_CONFIG.orgUrl.replace('https://', '').split('/')[0],
            path: `/${ADO_CONFIG.orgUrl.split('/').pop()}${apiPath}`,
            method: method,
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (res.statusCode >= 400) reject(json);
                    else resolve(json);
                } catch (e) { reject(e); }
            });
        });
        req.on('error', (e) => reject(e));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function searchTicketsByTitle(term) {
    const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${ADO_CONFIG.project}' AND [System.Title] CONTAINS '${term}' AND [System.State] <> 'Closed' ORDER BY [System.ChangedDate] DESC`;
    try {
        const searchResult = await adoRequest(`/_apis/wit/wiql?api-version=6.0`, 'POST', { query: wiql });
        const workItems = searchResult.workItems || [];

        if (workItems.length === 0) return [];

        const ids = workItems.slice(0, 10).map(i => i.id).join(',');
        const details = await adoRequest(`/_apis/wit/workitems?ids=${ids}&fields=System.Id,System.Title,System.State&api-version=6.0`, 'GET');

        return details.value.map(item => ({
            id: item.id,
            title: item.fields['System.Title'],
            state: item.fields['System.State']
        }));
    } catch (e) {
        console.error("Search Error:", e);
        return [];
    }
}

// --- CORE LOGIC ---
function processUniqueCommits(commits, targetBranch) {
    const sortedCommits = [...commits].sort((a, b) => new Date(b.date) - new Date(a.date));
    const seenFiles = new Set();
    const processed = [];

    for (const commit of sortedCommits) {
        const commitBody = require('child_process').execSync(`git show -s --format=%B ${commit.hash}`).toString();
        const workItemMatch = commitBody.match(/#(\d+)/);

        const touchedFiles = getCommitFiles(commit.hash);
        const effectiveFiles = touchedFiles.filter(file => !seenFiles.has(file));
        touchedFiles.forEach(file => seenFiles.add(file));
        const diff = effectiveFiles.length > 0 ? getSpecificFilesDiff(commit.hash, targetBranch, effectiveFiles) : '';

        processed.push({
            ...commit,
            diff: diff,
            isOverridden: effectiveFiles.length === 0 && touchedFiles.length > 0,
            workItemNumer: workItemMatch ? workItemMatch[1] : null
        });
    }
    return processed;
}

function executeCherryPick(newBranchName, selectedHashes, baseBranch) {
    try {
        console.log(`\n🚀 Starting Release Process: ${newBranchName}`);
        execSync(`git fetch origin ${baseBranch}`);
        try {
            execSync(`git checkout -b ${newBranchName} origin/${baseBranch}`);
        } catch (e) {
            throw new Error(`Branch ${newBranchName} creation failed. It might already exist.`);
        }

        let successCount = 0;
        let currentHashIndex = 0;

        for (const hash of selectedHashes) {
            currentHashIndex++;
            try {
                execSync(`git cherry-pick ${hash}`);
                successCount++;
                console.log(`✅ Successfully cherry-picked ${hash.substring(0, 7)}`);
            } catch (err) {
                console.error(`⚠️ Conflict detected at ${hash}`);
                const errorOutput = err.message || err.toString();
                console.error(`Error details: ${errorOutput}`);
                
                // Check if it's a conflict (not a different error)
                if (errorOutput.includes('CONFLICT') ||
                    errorOutput.includes('Automatic merge failed') ||
                    errorOutput.includes('could not apply') ||
                    errorOutput.includes('fix conflicts and then run "git cherry-pick --continue"')) {
                    console.log('🔄 Entering conflict resolution mode...');
                    
                    // Get conflicting files
                    const conflictingFiles = conflictResolution.getConflictingFiles();
                    
                    if (conflictingFiles.length === 0) {
                        console.error('No conflicting files found despite conflict error');
                        execSync(`git cherry-pick --abort`);
                        throw new Error(`Conflict at commit ${hash.substring(0, 7)} but no conflicting files found. Process stopped.`);
                    }

                    // Get file contents for conflict resolution
                    const fileContents = {};
                    conflictingFiles.forEach(file => {
                        try {
                            fileContents[file] = conflictResolution.getConflictContent(file);
                        } catch (error) {
                            fileContents[file] = `Error reading file: ${error.message}`;
                        }
                    });

                    // Save conflict state for persistence
                    const conflictState = {
                        state: 'CHERRY_PICK_CONFLICT',
                        branchName: newBranchName,
                        baseBranch: baseBranch,
                        totalCommits: selectedHashes.length,
                        completedCommits: successCount,
                        remainingCommits: selectedHashes.length - currentHashIndex,
                        currentCommit: hash,
                        currentCommitIndex: currentHashIndex,
                        selectedHashes: selectedHashes,
                        conflictingFiles: conflictingFiles,
                        fileContents: fileContents,
                        timestamp: new Date().toISOString()
                    };
                    
                    conflictResolution.saveConflictState(conflictState);

                    return { 
                        success: false, 
                        requiresConflictResolution: true,
                        conflictState: conflictState,
                        message: `Conflict detected at commit ${hash.substring(0, 7)}. ${conflictingFiles.length} file(s) need resolution.`
                    };
                } else {
                    // Not a conflict, abort and throw error
                    execSync(`git cherry-pick --abort`);
                    throw new Error(`Error at commit ${hash.substring(0, 7)}: ${errorOutput}`);
                }
            }
        }

        // All commits successfully cherry-picked
        const releases = loadReleases();
        releases[newBranchName] = {
            created: new Date().toISOString(),
            base: baseBranch,
            commits: selectedHashes,
            notes: ''
        };
        saveReleases(releases);

        return { success: true, message: `Created branch with ${successCount} commits.` };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

function appendToRelease(branchName, newHashes) {
    try {
        console.log(`\n🚀 Appending to: ${branchName}`);
        try {
            execSync(`git checkout ${branchName}`);
        } catch (e) {
            throw new Error(`Could not checkout ${branchName}. Does it exist locally?`);
        }

        let successCount = 0;
        let currentHashIndex = 0;

        for (const hash of newHashes) {
            currentHashIndex++;
            try {
                execSync(`git cherry-pick ${hash}`);
                successCount++;
                console.log(`✅ Successfully appended ${hash.substring(0, 7)}`);
            } catch (err) {
                console.error(`⚠️ Conflict detected while appending ${hash}`);
                const errorOutput = err.message || err.toString();
                
                if (errorOutput.includes('CONFLICT') || errorOutput.includes('Automatic merge failed')) {
                    const conflictingFiles = conflictResolution.getConflictingFiles();
                    
                    if (conflictingFiles.length === 0) {
                        execSync(`git cherry-pick --abort`);
                        throw new Error(`Conflict at commit ${hash.substring(0, 7)} but no conflicting files found.`);
                    }

                    const fileContents = {};
                    conflictingFiles.forEach(file => {
                        try {
                            fileContents[file] = conflictResolution.getConflictContent(file);
                        } catch (error) {
                            fileContents[file] = `Error reading file: ${error.message}`;
                        }
                    });

                    // Load existing release to get total commit count
                    const releases = loadReleases();
                    const existingRelease = releases[branchName];
                    const existingCommits = existingRelease ? (existingRelease.commits || []) : [];

                    const conflictState = {
                        state: 'CHERRY_PICK_CONFLICT',
                        branchName: branchName,
                        baseBranch: existingRelease ? existingRelease.base : 'unknown',
                        totalCommits: existingCommits.length + newHashes.length,
                        completedCommits: existingCommits.length + successCount,
                        remainingCommits: newHashes.length - currentHashIndex,
                        currentCommit: hash,
                        currentCommitIndex: existingCommits.length + currentHashIndex,
                        selectedHashes: [...existingCommits, ...newHashes],
                        conflictingFiles: conflictingFiles,
                        fileContents: fileContents,
                        isAppending: true,
                        timestamp: new Date().toISOString()
                    };
                    
                    conflictResolution.saveConflictState(conflictState);

                    return { 
                        success: false, 
                        requiresConflictResolution: true,
                        conflictState: conflictState,
                        message: `Conflict detected while appending commit ${hash.substring(0, 7)}. ${conflictingFiles.length} file(s) need resolution.`
                    };
                } else {
                    execSync(`git cherry-pick --abort`);
                    throw new Error(`Error appending commit ${hash.substring(0, 7)}: ${errorOutput}`);
                }
            }
        }

        const releases = loadReleases();
        if (releases[branchName]) {
            releases[branchName].commits = [...(releases[branchName].commits || []), ...newHashes];
            saveReleases(releases);
        }

        return { success: true, message: `Appended ${successCount} commits to ${branchName}.` };

    } catch (error) {
        return { success: false, message: error.message };
    }
}

// --- HTML GENERATOR ---
// Updated to accept availabilityMap
function generateHTML(commits, initialMapping, branch1, branch2, availabilityMap) {
    const commitsJson = JSON.stringify(commits);
    const mappingJson = JSON.stringify(initialMapping);
    const availabilityJson = JSON.stringify(availabilityMap[branch2] || {}); // Send only for current target

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Persistent Release Mapper</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/diff2html@3.4.47/bundles/css/diff2html.min.css">
    <style>
        #diff-target { position: relative; }
        :root { --primary: #0052cc; --bg: #f4f5f7; --border: #dfe1e6; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); margin: 0; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
        header { background: #fff; padding: 10px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); z-index: 10; }
        .main-container { display: flex; flex: 1; overflow: hidden; }
        .col-left { width: 400px; background: #fafbfc; border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
        .col-right { flex: 1; display: flex; flex-direction: column; background: #fff; overflow: hidden; }
        .list-header { padding: 10px; background: #f4f5f7; font-weight: 600; color: #5e6c84; font-size: 0.85rem; text-transform: uppercase; border-bottom: 1px solid var(--border); display:flex; justify-content:space-between; }
        .commit-pool { flex: 1; overflow-y: auto; padding: 10px; }
        .commit-card { background: white; border: 1px solid var(--border); border-radius: 3px; padding: 8px; margin-bottom: 8px; cursor: move; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: 0.2s; position: relative; }
        .commit-card:hover { border-color: var(--primary); transform: translateY(-1px); }
        .commit-card.dragging { opacity: 0.5; background: #e6f7ff; }
        .commit-card.disabled { opacity: 0.5; background: #f4f5f7; cursor: not-allowed; }
        .commit-card.disabled .c-msg { text-decoration: line-through; color: #888; }
        
        /* User Excluded Style */
        .commit-card.user-excluded { opacity: 0.6; background: #f0f0f0; border-style: dashed; }
        .commit-card.user-excluded .c-msg { color: #888; font-style: italic; }
        .excluded-badge { font-size: 0.7rem; background: #ccc; color: #fff; padding: 1px 4px; border-radius: 3px; margin-left: 5px; }

        .c-msg { font-size: 0.9rem; font-weight: 500; color: #172b4d; margin-bottom: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .c-meta { font-size: 0.75rem; color: #6b778c; display: flex; justify-content: space-between; }
        .c-link {
            background: #e9f2ff;
            color: var(--primary);
            padding: 1px 6px;
            border-radius: 3px;
            font-family: monospace;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.2s ease;
            border: 1px solid transparent;
            display: inline-flex;
            align-items: center;
            gap: 3px;
        }

        .branch-pill {
            font-weight: 400; 
            color: #666; 
            font-size: 0.9rem; 
            cursor: pointer; 
            padding: 4px 8px; 
            border-radius: 3px; 
            transition: 0.2s;
            border: 1px solid transparent;
        }
        .branch-pill:hover {
            background: #f4f5f7;
            border-color: #dfe1e6;
            color: var(--primary);
        }

        .c-link:hover {
            background: #cce0ff;
            border-color: var(--primary);
            text-decoration: none;
            transform: translateY(-1px);
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }

        .c-link:active {
            transform: translateY(0);
        }
        .c-tag { background: #dfe1e6; padding: 1px 4px; border-radius: 3px; font-family: monospace; }
        .c-warn { color: #de350b; font-size: 0.7rem; font-weight: bold; }

        .plan-header { padding: 15px; border-bottom: 1px solid var(--border); display: flex; gap: 10px; align-items: center; background: #fff; position: relative; }
        .ticket-search-wrapper { position: relative; width: 350px; }
        .ticket-input { padding: 8px; border: 2px solid var(--border); border-radius: 4px; width: 100%; outline: none; transition: 0.2s; box-sizing: border-box; }
        .ticket-input:focus { border-color: var(--primary); }
        
        .search-results {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: white;
            border: 1px solid var(--border);
            border-radius: 0 0 4px 4px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            max-height: 300px;
            overflow-y: auto;
            z-index: 100;
            display: none;
        }
        .search-item {
            padding: 8px 12px;
            border-bottom: 1px solid #f0f0f0;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .search-item:last-child { border-bottom: none; }
        .search-item:hover { background: #e6f7ff; }
        .si-id { font-weight: bold; color: var(--primary); font-size: 0.85rem; min-width: 50px; }
        .si-title { flex: 1; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0 10px; }
        .si-state { font-size: 0.75rem; color: #666; background: #eee; padding: 2px 5px; border-radius: 3px; }

        .plan-board { flex: 1; overflow-y: auto; padding: 20px; background: var(--bg); display: flex; flex-direction: column; gap: 15px; }
        .ticket-bucket { background: white; border-radius: 4px; border: 1px solid var(--border); box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; display: flex; flex-direction: column; flex-shrink: 0}
        .tb-header { padding: 10px 15px; background: #fff; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; cursor: pointer; }
        .tb-title { font-weight: 600; color: #172b4d; display: flex; align-items: center; gap: 10px; }
        .tb-content { min-height: 60px; padding: 10px; background: #fafbfc; border-top: 1px solid transparent; transition: 0.2s; }
        .tb-content.drag-over { background: #e6f7ff; border-top-color: var(--primary); }
        .empty-bucket { text-align: center; color: #97a0af; font-size: 0.9rem; padding: 15px; border: 2px dashed #dfe1e6; border-radius: 4px; }
        
        .status-badge { font-size:0.7rem; padding: 2px 5px; border-radius:4px; background: #eee; }
        .btn-del { background: transparent; border: none; color: #999; font-size: 1.2rem; line-height: 1; margin-left: 10px; cursor: pointer; padding: 0 5px; border-radius: 3px; transition: 0.2s; }
        .btn-del:hover { color: #de350b; background-color: #ffebe6; }
        .modal-overlay { display: none; position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.5); z-index: 100; align-items: center; justify-content: center; }
        .modal { background: white; padding: 25px; border-radius: 5px; width: 450px; box-shadow: 0 5px 15px rgba(0,0,0,0.3); max-height: 90vh; overflow-y: auto; }
        .btn { background: var(--primary); color: white; border: none; padding: 8px 16px; border-radius: 3px; cursor: pointer; font-weight: 600; }
        .btn:disabled { background: #dfe1e6; color: #a5adba; cursor: not-allowed; }
        .btn-sec { background: rgba(9, 30, 66, 0.08); color: #42526e; margin-right: 10px; }
        .diff-modal { width: 80%; height: 80%; display: flex; flex-direction: column; }
        .diff-body { flex: 1; overflow: auto; padding: 10px; border: 1px solid #ddd; margin: 10px 0; }
        .filter-controls { display: flex; gap: 5px; padding: 0 10px 10px 10px; background: #f4f5f7; border-bottom: 1px solid var(--border); }
        .filter-btn {
            flex: 1;
            padding: 4px 0;
            font-size: 0.75rem;
            border: 1px solid var(--border);
            background: #fff;
            color: #5e6c84;
            border-radius: 3px;
            cursor: pointer;
            font-weight: 500;
            transition: all 0.2s;
        }
        .filter-btn.active {
            background: var(--primary);
            color: white;
            border-color: var(--primary);
        }
        .filter-btn:hover:not(.active) { background: #ebecf0; }

        .release-list-container {
            max-height: 300px;
            overflow-y: auto;
            border-bottom: 1px solid var(--border);
        }
        .release-item {
            padding: 8px 12px;
            border-bottom: 1px solid #eee;
            cursor: pointer;
            font-size: 0.9rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .release-item:hover { background: #f4f5f7; color: var(--primary); }
        .release-item.drag-over { background: #dff0d8; border: 2px dashed #3c763d; }
        .ri-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
        .ri-date { font-size: 0.75rem; color: #888; }
        .commit-row-sm { font-size: 0.8rem; border-bottom: 1px solid #eee; padding: 5px; display: flex; gap: 10px; }

        /* Context Menu Styles */
        .context-menu {
            position: absolute;
            background: white;
            border: 1px solid #ddd;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            border-radius: 4px;
            z-index: 1000;
            display: none;
            min-width: 150px;
        }
        .context-menu ul { list-style: none; margin: 0; padding: 5px 0; }
        .context-menu li { padding: 8px 15px; cursor: pointer; font-size: 0.85rem; color: #333; }
        .context-menu li:hover { background: #f0f0f0; color: var(--primary); }
        .notes-section {
            margin-top: 20px;
            padding-top: 15px;
            border-top: 1px solid var(--border);
        }
        .notes-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .notes-header h4 {
            margin: 0;
            font-size: 0.95rem;
            color: #172b4d;
        }
        .notes-toggle {
            display: flex;
            gap: 5px;
        }
        .toggle-btn {
            padding: 4px 10px;
            font-size: 0.75rem;
            border: 1px solid var(--border);
            background: #fff;
            color: #5e6c84;
            border-radius: 3px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .toggle-btn.active {
            background: var(--primary);
            color: white;
            border-color: var(--primary);
        }
        .notes-textarea {
            width: 100%;
            min-height: 200px;
            padding: 10px;
            border: 1px solid var(--border);
            border-radius: 4px;
            font-family: monospace;
            font-size: 0.85rem;
            resize: vertical;
            box-sizing: border-box;
        }
        .notes-textarea:focus {
            outline: none;
            border-color: var(--primary);
        }
        .notes-preview {
            padding: 10px;
            border: 1px solid var(--border);
            border-radius: 4px;
            background: #fafbfc;
            min-height: 200px;
            max-height: 400px;
            overflow-y: auto;
            font-size: 0.9rem;
            line-height: 1.6;
        }
        .notes-preview h1 { font-size: 1.5rem; margin-top: 0; }
        .notes-preview h2 { font-size: 1.3rem; margin-top: 1em; }
        .notes-preview h3 { font-size: 1.1rem; margin-top: 1em; }
        .notes-preview ul, .notes-preview ol { padding-left: 20px; }
        .notes-preview code { background: #f0f0f0; padding: 2px 4px; border-radius: 3px; font-family: monospace; }
        .notes-preview pre { background: #f0f0f0; padding: 10px; border-radius: 4px; overflow-x: auto; }
        .notes-preview blockquote { border-left: 3px solid var(--border); padding-left: 10px; color: #666; margin: 10px 0; }
        .notes-save-status {
            font-size: 0.75rem;
            color: #00875a;
            margin-top: 5px;
            display: none;
        }
        .branch-item {
            padding: 12px;
            border: 1px solid var(--border);
            border-radius: 4px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: 0.2s;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .branch-item:hover { background: #e6f7ff; border-color: var(--primary); }
        .branch-item.current { background: #f4f5f7; font-weight: 600; }
        
        /* Pull Request Styles */
        .pr-container {
            background: white;
            border-radius: 4px;
            border: 1px solid var(--border);
            margin-bottom: 15px;
            overflow: hidden;
        }
        .pr-header {
            padding: 12px 15px;
            background: #f4f5f7;
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
        }
        .pr-header:hover { background: #ebecf0; }
        .pr-title-section {
            display: flex;
            align-items: center;
            gap: 10px;
            flex: 1;
        }
        .pr-expand-icon {
            font-size: 0.8rem;
            color: #666;
            transition: transform 0.2s;
        }
        .pr-expand-icon.expanded { transform: rotate(90deg); }
        .pr-count-badge {
            background: var(--primary);
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .pr-list {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease;
        }
        .pr-list.expanded { max-height: 600px; overflow-y: auto; }
        .pr-item {
            padding: 12px 15px;
            border-bottom: 1px solid #f0f0f0;
            transition: background 0.2s;
        }
        .pr-item:last-child { border-bottom: none; }
        .pr-item:hover { background: #f9f9f9; }
        .pr-item-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 6px;
        }
        .pr-item-title {
            font-weight: 500;
            color: #172b4d;
            font-size: 0.9rem;
            flex: 1;
            margin-right: 10px;
        }
        .pr-status-badge {
            font-size: 0.7rem;
            padding: 3px 8px;
            border-radius: 3px;
            font-weight: 600;
            white-space: nowrap;
        }
        .pr-status-active { background: #e3fcef; color: #006644; }
        .pr-status-completed { background: #deebff; color: #0052cc; }
        .pr-status-abandoned { background: #ffebe6; color: #de350b; }
        .pr-item-meta {
            display: flex;
            gap: 15px;
            font-size: 0.75rem;
            color: #6b778c;
            flex-wrap: wrap;
        }
        .pr-meta-item {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .pr-branch-badge {
            background: #dfe1e6;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
            font-size: 0.7rem;
        }
        .pr-link-btn {
            background: transparent;
            border: 1px solid var(--primary);
            color: var(--primary);
            padding: 4px 10px;
            border-radius: 3px;
            font-size: 0.75rem;
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
            display: inline-block;
        }
        .pr-link-btn:hover {
            background: var(--primary);
            color: white;
        }
        .pr-loading {
            text-align: center;
            padding: 20px;
            color: #666;
            font-size: 0.9rem;
        }
        .pr-empty {
            text-align: center;
            padding: 20px;
            color: #999;
            font-size: 0.9rem;
        }
        .pr-refresh-btn {
            background: transparent;
            border: 1px solid var(--border);
            color: #5e6c84;
            padding: 4px 10px;
            border-radius: 3px;
            font-size: 0.75rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        .pr-refresh-btn:hover {
            background: #f4f5f7;
            border-color: var(--primary);
            color: var(--primary);
        }
    </style>
</head>
<body>

<header>
    <div style="font-weight:bold; font-size:1.1rem;">Persistent Release <span class="branch-pill" onclick="showBranchModal('source')">${branch1} ▾</span>
        <span style="color:#ccc; margin:0 5px;">→</span>
        <span class="branch-pill" onclick="showBranchModal('target')">${branch2} ▾</span></div>
    <div>
        <span id="save-status" style="font-size:0.8rem; color:#00875a; margin-right:15px; display:none;">Saved!</span>
        <button class="btn btn-sec" onclick="generateAiPrompt()">✨ AI Note Prompt</button>
        <button class="btn btn-sec" onclick="copyLocalCherryPick()">📋 Copy CP Cmd</button>
        <button class="btn" onclick="showReleaseModal()">🚀 Create Release Branch</button>
    </div>
</header>

<div class="main-container">
    <div class="col-left">
        <div class="list-header">
            Active Releases
            <button onclick="refreshReleases()" style="border:none; background:none; cursor:pointer; font-size:0.8rem;">↻</button>
        </div>
        <div id="release-list" class="release-list-container"></div>

        <!-- Pull Requests Section -->
        <div class="list-header" style="margin-top: 10px;">
            Pull Requests
            <button onclick="togglePRSection()" id="pr-toggle-btn" style="border:none; background:none; cursor:pointer; font-size:0.8rem;">▼</button>
        </div>
        <div id="pr-section" class="release-list-container" style="max-height: 300px;"></div>

        <div class="list-header" style="display: block;">
            <div style="display:flex; justify-content:space-between; margin-bottom: 5px;">
                <span>Unassigned Commits (<span id="pool-count">0</span>)</span>
            </div>
            <input id="commit-search" type="text" placeholder="Filter message..." onkeyup="applyFilters()" style="width:100%; box-sizing:border-box; padding:5px; border:1px solid #dfe1e6; border-radius:3px; font-size:0.9rem;">
            </div>
            <div class="filter-controls">
                <button class="filter-btn active" onclick="setFilterMode('all', this)">Show All</button>
                <button class="filter-btn" onclick="setFilterMode('pickable', this)">Pickable Only</button>
            </div>
        <div id="commit-pool" class="commit-pool" ondrop="drop(event, 'pool')" ondragover="allowDrop(event)"></div>
    </div>

    <div class="col-right">
        <div class="plan-header">
            <div class="ticket-search-wrapper">
                <input type="text" id="ticket-input" class="ticket-input" 
                       placeholder="Search ID or Title..." 
                       onkeyup="handleSearch(event)" 
                       autocomplete="off">
                <div id="search-results" class="search-results"></div>
            </div>
            <button class="btn btn-sec" onclick="addTicketManual()">+ Add ID</button>
        </div>
        <div id="plan-board" class="plan-board"></div>
    </div>
</div>

<div class="modal-overlay" id="release-modal">
    <div class="modal">
        <h3>Create Release Branch</h3>
        <div style="margin-bottom:15px;">
            <label style="display:block; font-weight:600; margin-bottom:5px;">Branch Name</label>
            <input type="text" id="rel-branch-name" style="width:100%; padding:8px;" value="release/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_v1">
        </div>
        <p style="font-size:0.9rem; color:#666;">Will cherry-pick commits from selected tickets in chronological order.</p>
        <div style="text-align:right; margin-top:20px;">
            <button class="btn btn-sec" onclick="closeModal('release-modal')">Cancel</button>
            <button class="btn" onclick="submitRelease()" id="btn-confirm">Confirm</button>
        </div>
    </div>
</div>

<div class="modal-overlay" id="release-details-modal">
    <div class="modal" style="width: 600px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
            <h3 id="rd-title" style="margin:0">Release Details</h3>
            <button class="btn-del" onclick="closeModal('release-details-modal')">×</button>
        </div>
        <p style="font-size:0.85rem; color:#666;">Commits currently in this release branch:</p>
        <div id="rd-commits" style="max-height: 400px; overflow-y: auto; background: #fafbfc; border: 1px solid #eee; padding: 10px; margin-bottom: 10px;"></div>
        
        <div class="notes-section">
            <div class="notes-header">
                <h4>Release Notes</h4>
                <div class="notes-toggle">
                    <button class="toggle-btn active" onclick="toggleNotesMode('edit')">Edit</button>
                    <button class="toggle-btn" onclick="toggleNotesMode('preview')">Preview</button>
                </div>
            </div>
            <textarea id="release-notes-input" class="notes-textarea" placeholder="Enter release notes in Markdown format..."></textarea>
            <div id="release-notes-preview" class="notes-preview" style="display:none;"></div>
            <div id="notes-save-status" class="notes-save-status">Notes saved!</div>
        </div>
        
        <div style="border-top:1px solid #eee; padding-top:10px; margin-top:15px;">
            <p style="font-size:0.85rem;"><strong>Tip:</strong> Drag commits from the main pool onto the release name in the sidebar to append them!</p>
        </div>
    </div>
</div>

<div class="modal-overlay" id="diff-modal">
    <div class="modal diff-modal">
        <div style="display:flex; justify-content:space-between;">
            <h3 id="diff-title" style="margin:0">Commit Diff</h3>
            <button class="btn btn-sec" onclick="closeModal('diff-modal')">Close</button>
        </div>
        <div class="diff-body" id="diff-content"></div>
    </div>
</div>

<div class="modal-overlay" id="branch-modal">
    <div class="modal" style="width: 500px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h3 id="branch-modal-title" style="margin:0">Switch Branch</h3>
            <button class="btn-sec" style="padding:4px 8px; font-size:0.8rem;" onclick="refreshBranchList()">
                🔄 Refresh Remotes
            </button>
        </div>
        <div id="branch-list" style="max-height: 400px; overflow-y: auto; margin: 15px 0;"></div>
        <div style="text-align:right; margin-top:20px;">
            <button class="btn btn-sec" onclick="closeModal('branch-modal')">Cancel</button>
        </div>
    </div>
</div>

<!-- Context Menu Structure -->
<div id="context-menu" class="context-menu">
    <ul>
        <li onclick="copyCommitBody()">Copy Commit Body</li>
        <li onclick="copyChanges()">Copy Changes</li>
        <li id="ctx-toggle-avail" onclick="toggleCommitAvailability()">Mark as Unavailable</li>
        <li id="ctx-pr-changes" onclick="copyPRChanges()" style="display:none; font-weight: bold; color: var(--primary);">📋 Copy PR Diff (for AI Review)</li>
    </ul>
</div>

<script src="https://cdn.jsdelivr.net/npm/diff2html@3.4.47/bundles/js/diff2html-ui.min.js"></script>
<script>
    const allCommits = ${commitsJson};
    const commitMap = allCommits.reduce((acc, c) => { acc[c.hash] = c; return acc; }, {});
    let mapping = ${mappingJson}; 
    let availabilityMap = ${availabilityJson};

    let currentContextMenuHash = null;
    let currentNotesMode = 'edit';
    let currentReleaseName = null;
    let prSectionExpanded = true;
    let prCache = { data: null, timestamp: null };
    const PR_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

    let currentPRData = { source: null, target: null };

    function showPRContextMenu(e, source, target) {
        e.preventDefault();
        e.stopPropagation();
        currentPRData = { source, target };
        
        const menu = document.getElementById('context-menu');
        
        // Hide commit-specific items, show PR-specific item
        setDisplay('ctx-commit-body', 'none');
        setDisplay('ctx-commit-changes', 'none');
        setDisplay('ctx-toggle-avail', 'none');
        setDisplay('ctx-pr-changes', 'block');

        menu.style.display = 'block';
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
    }

    function copyPRChanges() {
        if (!currentPRData.source || !currentPRData.target) return;
        document.getElementById('context-menu').style.display = 'none';
        
        const btn = document.getElementById('ctx-pr-changes');
        const originalText = btn.innerText;
        
        fetch(\`/get-pr-diff?source=\${encodeURIComponent(currentPRData.source)}&target=\${encodeURIComponent(currentPRData.target)}\`)
            .then(res => res.json())
            .then(response => {
                if(response.success) {
                    navigator.clipboard.writeText(response.data).then(() => {
                        alert(\`✅ PR Diff copied!\nBranches: \${currentPRData.source} -> \${currentPRData.target}\`);
                    });
                } else {
                    alert('Error fetching PR diff: ' + response.message);
                }
            })
            .catch(e => alert('Network error: ' + e.message));
    }

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    function generateAiPrompt() {
        const selectedCheckboxes = document.querySelectorAll('.t-check:checked');
        if(selectedCheckboxes.length === 0) return alert('Please select at least one ticket to generate a prompt.');
        
        const ids = Array.from(selectedCheckboxes).map(cb => cb.value);
        const btn = document.querySelector('button[onclick="generateAiPrompt()"]');
        const originalText = btn.innerText;
        
        btn.innerText = 'Fetching info...';
        btn.disabled = true;

        fetch('/get-ticket-details-bulk', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ ids })
        })
        .then(res => res.json())
        .then(response => {
            if(!response.success) throw new Error(response.message);
            
            let prompt = "Act as a Senior Release Manager. Create professional Release Notes based on the following tickets.\\n\\n";
            prompt += "Formatting Rules:\\n";
            prompt += "- Use Markdown format.\\n";
            prompt += "- Group by Ticket Type (e.g., Feature, Bug Fix).\\n";
            prompt += "- Summarize the technical description into user-friendly language.\\n";
            prompt += "- Do not include internal technical jargon unless necessary.\\n\\n";
            prompt += "--- TICKET DATA ---\\n\\n";

            response.data.forEach(t => {
                prompt += \`Ticket: #\${t.id} (\${t.type})\\n\`;
                prompt += \`Title: \${t.title}\\n\`;
                prompt += \`Context/Description: \${(t.description || '').substring(0, 1500)}\\n\`; 
                prompt += "--------------------------------------------------\\n\\n";
            });

            navigator.clipboard.writeText(prompt).then(() => {
                alert('✅ Prompt copied to clipboard! Paste it into AI Studio.');
            }).catch(err => {
                console.error('Copy failed', err);
                alert('Could not copy to clipboard. Check console.');
            });
        })
        .catch(e => {
            alert('Error generating prompt: ' + e.message);
        })
        .finally(() => {
            btn.innerText = originalText;
            btn.disabled = false;
        });
    }

    function copyLocalCherryPick() {
        const selectedCheckboxes = document.querySelectorAll('.t-check:checked');
        if(selectedCheckboxes.length === 0) return alert('Please select at least one ticket.');
        
        let validCommits = [];
        selectedCheckboxes.forEach(cb => {
            const tid = cb.value;
            if(mapping[tid] && mapping[tid].commits) {
                mapping[tid].commits.forEach(h => {
                    if(commitMap[h]) validCommits.push(commitMap[h]);
                });
            }
        });

        if(validCommits.length === 0) return alert('No commits found in selected tickets.');

        validCommits.sort((a, b) => new Date(a.date) - new Date(b.date));

        const hashString = validCommits.map(c => c.hash).join(' ');

        const command = \`git cherry-pick \${hashString}\`;

        navigator.clipboard.writeText(command).then(() => {
            alert('✅ Cherry-pick command copied! Run this in your local terminal.');
        }).catch(err => {
            console.error('Copy failed', err);
            prompt("Could not auto-copy. Manually copy this:", command);
        });
    }

    let currentBranchModalType = 'target';

    function showBranchModal(type) {
        currentBranchModalType = type;
        document.getElementById('branch-modal-title').innerText = type === 'source' ? 'Switch Source Branch' : 'Switch Target Branch';
        loadBranchesIntoModal(false);
        
        document.getElementById('branch-modal').style.display = 'flex';
    }

    function refreshBranchList() {
        const btn = document.querySelector('#branch-modal button.btn-sec');
        const originalText = btn.innerText;
        
        btn.innerText = 'Fetching...';
        btn.disabled = true;
        
        loadBranchesIntoModal(true).finally(() => {
            btn.innerText = originalText;
            btn.disabled = false;
        });
    }

    function loadBranchesIntoModal(forceRefresh) {
        const list = document.getElementById('branch-list');
        if(forceRefresh) list.innerHTML = '<div style="padding:20px; text-align:center; color:#666;">Fetching from origin...</div>';

        return fetch('/get-branches?refresh=' + (forceRefresh ? 'true' : 'false'))
            .then(res => res.json())
            .then(branches => {
                list.innerHTML = '';
                
                const currentVal = currentBranchModalType === 'source' ? '${branch1}' : '${branch2}';

                branches.forEach(branch => {
                    const isCurrent = branch === currentVal;
                    const div = document.createElement('div');
                    div.className = 'branch-item' + (isCurrent ? ' current' : '');
                    div.innerHTML = \`
                        <span>\${branch}</span>
                        \${isCurrent ? '<span style="color:var(--primary); font-size:0.8rem;">✓ Current</span>' : ''}
                    \`;
                    if (!isCurrent) {
                        div.onclick = () => switchBranch(currentBranchModalType, branch);
                    }
                    list.appendChild(div);
                });
            })
            .catch(err => {
                list.innerHTML = '<div style="color:red; padding:10px;">Error loading branches</div>';
            });
    }

    function switchBranch(type, newBranchName) {
        let s = '${branch1}';
        let t = '${branch2}';
        
        if (type === 'source') {
            s = newBranchName;
        } else {
            t = newBranchName;
        }
        
        window.location.href = \`/?source=\${encodeURIComponent(s)}&target=\${encodeURIComponent(t)}\`;
    }

    function init() {
        const pool = document.getElementById('commit-pool');
        const assignedHashes = new Set();
        Object.values(mapping).forEach(ticket => {
            if(ticket.commits) ticket.commits.forEach(h => assignedHashes.add(h));
        });

        Object.values(mapping).forEach(t => renderTicketBucket(t));

        allCommits.forEach(c => {
            if(!assignedHashes.has(c.hash)) {
                pool.appendChild(createCommitEl(c));
            }
        });
        
        Object.values(mapping).forEach(t => {
            const container = document.getElementById('content-' + t.id);
            if(t.commits && t.commits.length > 0) {
                const empty = container.querySelector('.empty-bucket');
                if(empty) empty.remove();
                t.commits.forEach(h => {
                    if(commitMap[h]) container.appendChild(createCommitEl(commitMap[h]));
                });
            }
        });
        updateCounts();
        
        refreshReleases();
        loadPullRequests();

        document.addEventListener('click', function(event) {
            const wrapper = document.querySelector('.ticket-search-wrapper');
            if (wrapper && !wrapper.contains(event.target)) {
                const sr = document.getElementById('search-results');
                if(sr) sr.style.display = 'none';
            }
            document.getElementById('context-menu').style.display = 'none';
        });
    }

    function refreshReleases() {
        fetch('/get-releases')
        .then(res => res.json())
        .then(releases => {
            const container = document.getElementById('release-list');
            container.innerHTML = '';
            if(Object.keys(releases).length === 0) {
                container.innerHTML = '<div style="padding:10px; color:#999; font-size:0.8rem; text-align:center;">No releases created yet</div>';
                return;
            }
            Object.entries(releases).sort((a,b) => new Date(b[1].created) - new Date(a[1].created)).forEach(([name, data]) => {
                const div = document.createElement('div');
                div.className = 'release-item';
                div.innerHTML = \`
                    <div>
                        <div class="ri-name">\${name}</div>
                        <div class="ri-date">\${new Date(data.created).toLocaleDateString()} · \${data.commits ? data.commits.length : 0} commits</div>
                    </div>
                    <button class="btn-del" onclick="deleteRelease(event, '\${name}')">×</button>
                \`;
                div.onclick = () => showReleaseDetails(name, data);
                div.ondragover = (e) => { e.preventDefault(); div.classList.add('drag-over'); };
                div.ondragleave = () => div.classList.remove('drag-over');
                div.ondrop = (e) => dropToRelease(e, name);
                
                container.appendChild(div);
            });
        });
    }
    
    function deleteRelease(ev, name) {
        ev.stopPropagation();
        if(!confirm('Delete release history for "' + name + '"? This does not delete the git branch.')) return;
        
        fetch('/delete-release', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ branchName: name })
        })
        .then(res => res.json())
        .then(data => {
            if(data.success) {
                refreshReleases();
            } else {
                alert(data.message);
            }
        });
    }

    function showReleaseDetails(name, data) {
        currentReleaseName = name;
        currentNotesMode = 'edit';
        
        document.getElementById('rd-title').innerText = name;
        const list = document.getElementById('rd-commits');
        list.innerHTML = '';
        if(!data.commits || data.commits.length === 0) {
            list.innerHTML = '<div style="color:#999;">No commits recorded.</div>';
        } else {
            data.commits.forEach(h => {
                const c = commitMap[h];
                const row = document.createElement('div');
                row.className = 'commit-row-sm';
                if(c) {
                    row.innerHTML = \`<span style="font-weight:bold;">\${h.substring(0,7)}</span> <span>\${escapeHtml(c.message)}</span>\`;
                } else {
                    row.innerHTML = \`<span style="font-weight:bold;">\${h.substring(0,7)}</span> <span style="color:#999;">(Commit not in current scope)</span>\`;
                }
                list.appendChild(row);
            });
        }
        
        const notesInput = document.getElementById('release-notes-input');
        const notesPreview = document.getElementById('release-notes-preview');
        notesInput.value = data.notes || '';
        
        notesInput.style.display = 'block';
        notesPreview.style.display = 'none';
        document.querySelectorAll('.notes-toggle .toggle-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector('.notes-toggle .toggle-btn:first-child').classList.add('active');
        
        document.getElementById('release-details-modal').style.display = 'flex';
    }

    function dropToRelease(ev, branchName) {
        ev.preventDefault();
        ev.target.closest('.release-item').classList.remove('drag-over');
        const dataId = ev.dataTransfer.getData("text");
        if(!dataId.startsWith('c-')) return;
        
        const hash = document.getElementById(dataId).dataset.hash;
        if(!confirm('Append commit ' + hash.substring(0,7) + ' to release "' + branchName + '"?')) return;

        fetch('/append-release', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ branchName, hashes: [hash] })
        })
        .then(res => res.json())
        .then(data => {
            if(data.success) {
                alert(data.message);
                refreshReleases();
            } else {
                alert('ERROR: ' + data.message);
            }
        });
    }

    const performSearch = debounce(async (term) => {
        const resultsDiv = document.getElementById('search-results');
        if (!term || term.length < 3) {
            resultsDiv.style.display = 'none';
            return;
        }

        try {
            const isId = /^\\d+$/.test(term);
            const endpoint = isId ? '/lookup-ticket?id=' + term : '/search-tickets?q=' + encodeURIComponent(term);
            
            const res = await fetch(endpoint);
            const data = await res.json();
            
            resultsDiv.innerHTML = '';
            
            const items = Array.isArray(data) ? data : (data.error ? [] : [{id: term, ...data}]);

            if (items.length === 0) {
                resultsDiv.innerHTML = '<div style="padding:10px; color:#999;">No results found</div>';
            } else {
                items.forEach(item => {
                    const el = document.createElement('div');
                    el.className = 'search-item';
                    el.innerHTML = \`
                        <span class="si-id">#\${item.id}</span>
                        <span class="si-title">\${escapeHtml(item.title)}</span>
                        <span class="si-state">\${item.state}</span>
                    \`;
                    el.onclick = () => selectTicket(item);
                    resultsDiv.appendChild(el);
                });
            }
            resultsDiv.style.display = 'block';

        } catch (e) {
            console.error(e);
        }
    }, 400);

    function handleSearch(e) {
        if(e.key === 'Enter') addTicketManual();
        else performSearch(e.target.value.trim());
    }

    function selectTicket(item) {
        addTicketToBoard(item.id, item.title, item.state);
        document.getElementById('ticket-input').value = '';
        document.getElementById('search-results').style.display = 'none';
    }

    function addTicketManual() {
        const input = document.getElementById('ticket-input');
        const id = input.value.trim().replace('#', '');
        if (!id) return;
        
        fetch('/lookup-ticket?id=' + id)
            .then(res => res.json())
            .then(data => {
                if(data.error) addTicketToBoard(id, 'Manual Entry', 'Unknown');
                else addTicketToBoard(id, data.title, data.state);
                input.value = '';
                document.getElementById('search-results').style.display = 'none';
            });
    }

    function addTicketToBoard(id, title, state) {
        if (mapping[id]) { alert('Ticket #' + id + ' already exists!'); return; }
        
        const newTicket = { id, title, state, commits: [] };

        const pool = document.getElementById('commit-pool');

        const autoPickedHashes = [];
        allCommits.forEach(c => {
            if (c.workItemNumer == id) {
                 const commitEl = document.getElementById('c-' + c.hash);
                 if (commitEl && commitEl.parentElement === pool) {
                     autoPickedHashes.push(c.hash);
                 }
            }
        });

        newTicket.commits = autoPickedHashes;

        mapping[id] = newTicket;
        renderTicketBucket(newTicket);

        if(autoPickedHashes.length > 0) {
            const container = document.getElementById('content-' + id);
            const empty = container.querySelector('.empty-bucket');
            if(empty) empty.remove();

            autoPickedHashes.forEach(hash => {
                const el = document.getElementById('c-' + hash);
                if(el) container.appendChild(el);
            });
            updateCounts();
        }
        saveStateToServer();
    }

    function removeTicket(id) {
        if (!confirm('Remove ticket #' + id + '?')) return;
        const ticketContent = document.getElementById('content-' + id);
        const pool = document.getElementById('commit-pool');
        ticketContent.querySelectorAll('.commit-card').forEach(card => {
            card.classList.remove('dragging');
            pool.appendChild(card);
        });
        document.getElementById('ticket-' + id).remove();
        delete mapping[id];
        updateCounts();
        saveStateToServer();
    }

    function createCommitEl(c) {
        const el = document.createElement('div');
        const hasDiff = c.diff && c.diff.length > 0;
        const isExcluded = availabilityMap[c.hash] === 'unavailable';

        let className = 'commit-card';
        if (!hasDiff) className += ' disabled';
        if (isExcluded) className += ' user-excluded';
        
        el.className = className;
        el.draggable = true;
        el.id = 'c-' + c.hash;
        el.dataset.hash = c.hash;

        if (hasDiff) {
            el.ondragstart = drag;
            el.ondblclick = () => showDiff(c.hash);
        }
        
        // NEW: Right Click Handler
        el.oncontextmenu = (e) => showContextMenu(e, c.hash);

        el.ondragstart = drag;
        el.ondblclick = () => showDiff(c.hash);
        const workItemBaseUrl = "${ADO_CONFIG.orgUrl}/${ADO_CONFIG.project}/_workitems/edit/";
        el.innerHTML = \`
            <div class="c-msg">\${escapeHtml(c.message)}</div>
            <div class="c-meta">
                <span class="c-tag">\${c.hash.substring(0,7)}</span>
                <a href="\${workItemBaseUrl}\${c.workItemNumer}/" 
                    target="_blank" 
                    class="c-link" 
                    title="Open Work Item \${c.workItemNumer}"
                    onclick="event.stopPropagation()">
                    \${c.workItemNumer} ↗
                </a>
                <span>\${new Date(c.date).toLocaleDateString()}</span>
            </div>
            \${c.isOverridden ? '<div class="c-warn">⚠️ Overridden</div>' : ''}
            \${isExcluded ? '<div class="excluded-badge">Unavailable</div>' : ''}
        \`;
        return el;
    }

    const setDisplay = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.style.display = value;
    };

    function showContextMenu(e, hash) {
        e.preventDefault();
        currentContextMenuHash = hash;
        const menu = document.getElementById('context-menu');

        setDisplay('ctx-commit-body', 'block');
        setDisplay('ctx-commit-changes', 'block');
        setDisplay('ctx-toggle-avail', 'block');
        setDisplay('ctx-pr-changes', 'none');

        const isExcluded = availabilityMap[hash] === 'unavailable';
        document.getElementById('ctx-toggle-avail').innerText = isExcluded ? "Mark as Available" : "Mark as Unavailable";

        menu.style.display = 'block';
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
    }

    function copyCommitBody() {
        if (!currentContextMenuHash) return;
        document.getElementById('context-menu').style.display = 'none';
        
        fetch('/get-commit-body?hash=' + currentContextMenuHash)
            .then(res => res.json())
            .then(response => {
                if(response.success) {
                    navigator.clipboard.writeText(response.data).then(() => {
                        alert('Full commit body copied to clipboard!');
                    }).catch(err => {
                        alert('Failed to write to clipboard.');
                    });
                } else {
                    alert('Error: ' + response.message);
                }
            })
            .catch(e => alert('Network error: ' + e.message));
    }

    function copyChanges() {
        if (!currentContextMenuHash) return;
        document.getElementById('context-menu').style.display = 'none';

        const c = commitMap[currentContextMenuHash];
        
        if (!c || !c.diff) {
            return alert('No text changes available to copy.');
        }

        navigator.clipboard.writeText(c.diff).then(() => {
            alert('✅ Diff copied to clipboard!');
        }).catch(err => {
            alert('Clipboard write failed.');
        });
    }

    function toggleCommitAvailability() {
        if (!currentContextMenuHash) return;
        
        const isCurrentlyExcluded = availabilityMap[currentContextMenuHash] === 'unavailable';
        const newState = isCurrentlyExcluded ? 'available' : 'unavailable';
        
        if (newState === 'unavailable') availabilityMap[currentContextMenuHash] = 'unavailable';
        else delete availabilityMap[currentContextMenuHash];

        const el = document.getElementById('c-' + currentContextMenuHash);
        if(el) {
            const c = commitMap[currentContextMenuHash];
            const newEl = createCommitEl(c);
            el.replaceWith(newEl);
        }

        applyFilters();

        fetch('/toggle-availability', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                targetBranch: '${branch2}', 
                hash: currentContextMenuHash, 
                status: newState 
            })
        });
        
        document.getElementById('context-menu').style.display = 'none';
    }

    function renderTicketBucket(t) {
        const board = document.getElementById('plan-board');
        const div = document.createElement('div');
        div.className = 'ticket-bucket';
        div.id = 'ticket-' + t.id;
        div.innerHTML = \`
            <div class="tb-header">
                <div class="tb-title">
                    <input type="checkbox" checked class="t-check" value="\${t.id}">
                    <span style="background:#dfe1e6; padding:2px 6px; border-radius:3px; font-size:0.8rem;">#\${t.id}</span>
                    <span>\${escapeHtml(t.title)}</span>
                </div>
                <div style="display:flex; align-items:center;">
                    <div class="status-badge">\${t.state}</div>
                    <button class="btn-del" onclick="removeTicket('\${t.id}')">×</button>
                </div>
            </div>
            <div class="tb-content" id="content-\${t.id}" 
                 ondrop="drop(event, 'ticket', '\${t.id}')" 
                 ondragover="allowDrop(event)"
                 ondragenter="dragEnterBucket(this)"
                 ondragleave="dragLeaveBucket(this)">
                <div class="empty-bucket">Drag commits here</div>
            </div>
        \`;
        board.insertBefore(div, board.firstChild);
    }

    function allowDrop(ev) { ev.preventDefault(); }
    function drag(ev) { ev.dataTransfer.setData("text", ev.target.id); ev.target.classList.add('dragging'); }
    function dragEnterBucket(el) { el.classList.add('drag-over'); }
    function dragLeaveBucket(el) { el.classList.remove('drag-over'); }

    function drop(ev, targetType, ticketId) {
        ev.preventDefault();
        const data = ev.dataTransfer.getData("text");
        const el = document.getElementById(data);
        if(!el) return; 
        el.classList.remove('dragging');
        
        if (targetType === 'pool') {
            document.getElementById('commit-pool').appendChild(el);
        } else if (targetType === 'ticket') {
            const container = document.getElementById('content-' + ticketId);
            const empty = container.querySelector('.empty-bucket');
            if(empty) empty.remove();
            container.appendChild(el);
        }
        
        document.querySelectorAll('.tb-content').forEach(d => d.classList.remove('drag-over'));
        updateCounts();
        updateMappingModel();
    }

    function updateMappingModel() {
        Object.keys(mapping).forEach(k => mapping[k].commits = []);
        document.querySelectorAll('.ticket-bucket').forEach(bucket => {
            const tid = bucket.id.replace('ticket-', '');
            const content = bucket.querySelector('.tb-content');
            const commits = [];
            content.querySelectorAll('.commit-card').forEach(c => commits.push(c.dataset.hash));
            if(mapping[tid]) mapping[tid].commits = commits;
        });
        saveStateToServer();
    }

    function saveStateToServer() {
        const status = document.getElementById('save-status');
        status.style.display = 'none';
        fetch('/save-mapping', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(mapping)
        }).then(() => {
            status.style.display = 'inline-block';
            setTimeout(() => status.style.display = 'none', 2000);
        });
    }

    function updateCounts() {
        document.getElementById('pool-count').innerText = document.getElementById('commit-pool').children.length;
    }

    function showReleaseModal() {
        const tickets = document.querySelectorAll('.t-check:checked');
        if(tickets.length === 0) return alert('Select at least one ticket.');
        document.getElementById('release-modal').style.display = 'flex';
    }

    function submitRelease() {
        const branchName = document.getElementById('rel-branch-name').value;
        const btn = document.getElementById('btn-confirm');
        let hashes = [];
        document.querySelectorAll('.t-check:checked').forEach(t => {
            const tid = t.value;
            if(mapping[tid] && mapping[tid].commits) {
                mapping[tid].commits.forEach(h => { if(commitMap[h]) hashes.push(commitMap[h]); });
            }
        });
        hashes.sort((a, b) => new Date(a.date) - new Date(b.date));
        const hashStrings = [...new Set(hashes.map(h => h.hash))];

        btn.innerText = 'Processing...';
        btn.disabled = true;

        fetch('/create-release', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                branchName, 
                baseBranch: '${branch2}', 
                sourceBranch: '${branch1}',
                hashes: hashStrings,
                force: false 
            })
        })
        .then(res => res.json())
        .then(data => {

            if (data.requiresConfirmation) {
                const riskMsg = data.risks.map(r => 
                    \`⚠️ File: \${r.file}\\n   Picked: \${r.pickedCommit.hash.substring(0,7)}\\n   Skipped (Older): \${r.skippedCommit.hash.substring(0,7)} ("\${r.skippedCommit.msg}")\`
                ).join('\\n\\n');
                
                if (confirm(\`DEPENDENCY RISK DETECTED!\\n\\n\${riskMsg}\\n\\nDo you want to proceed anyway?\`)) {
                    // User clicked OK -> Retry with force: true
                    fetch('/create-release', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ 
                            branchName, 
                            baseBranch: '${branch2}', 
                            sourceBranch: '${branch1}',
                            hashes: hashStrings,
                            force: true
                        })
                    }).then(r => r.json()).then(finalData => {
                        closeModal('release-modal');
                        btn.innerText = 'Confirm';
                        btn.disabled = false;
                        if(finalData.success) { alert('SUCCESS: ' + finalData.message); refreshReleases(); }
                        else alert('ERROR: ' + finalData.message);
                    });
                    return;
                } else {
                    // User cancelled
                    btn.innerText = 'Confirm';
                    btn.disabled = false;
                    return;
                }
            }

            closeModal('release-modal');
            btn.innerText = 'Confirm';
            btn.disabled = false;
            if(data.success) {
                alert('SUCCESS: ' + data.message);
                refreshReleases();
            }
            else alert('ERROR: ' + data.message);
        });
    }

    function showDiff(hash) {
        const c = commitMap[hash];
        if(!c.diff) return alert('No effective changes.');
        document.getElementById('diff-title').innerText = c.message;
        document.getElementById('diff-content').innerHTML = '<div id="diff-target"></div>';
        document.getElementById('diff-modal').style.display = 'flex';
        const ui = new Diff2HtmlUI(document.getElementById('diff-target'), c.diff, { drawFileList: true, matching: 'lines' });
        ui.draw();
    }

    function closeModal(id) { document.getElementById(id).style.display = 'none'; }
    function escapeHtml(text) { return text ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : ''; }
    let filterMode = 'all'; 

    function setFilterMode(mode, btn) {
        filterMode = mode;
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyFilters();
    }

    function applyFilters() {
        const val = document.getElementById('commit-search').value.toLowerCase();
        
        document.querySelectorAll('#commit-pool .commit-card').forEach(el => {
            const hash = el.dataset.hash;
            const commitData = commitMap[hash];
            const txt = el.innerText.toLowerCase();
            const isUserExcluded = availabilityMap[hash] === 'unavailable';
            
            const matchesText = txt.includes(val);

            let matchesMode = true;
            if (filterMode === 'pickable') {
                const isDisabled = el.classList.contains('disabled');
                const isOverridden = commitData && commitData.isOverridden;
                if (isDisabled || isOverridden || isUserExcluded) {
                    matchesMode = false;
                }
            }

            el.style.display = (matchesText && matchesMode) ? 'block' : 'none';
        });
    }

    function toggleNotesMode(mode) {
        currentNotesMode = mode;
        const input = document.getElementById('release-notes-input');
        const preview = document.getElementById('release-notes-preview');
        
        document.querySelectorAll('.notes-toggle .toggle-btn').forEach(btn => btn.classList.remove('active'));
        
        if (mode === 'edit') {
            input.style.display = 'block';
            preview.style.display = 'none';
            document.querySelector('.notes-toggle .toggle-btn:first-child').classList.add('active');
        } else {
            input.style.display = 'none';
            preview.style.display = 'block';
            document.querySelector('.notes-toggle .toggle-btn:last-child').classList.add('active');
            
            const markdown = input.value;
            preview.innerHTML = renderMarkdown(markdown);
        }
    }

    function renderMarkdown(text) {
        if (!text) return '<p style="color:#999;">No notes yet. Switch to Edit mode to add notes.</p>';
        
        let html = text;
        
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
        
        html = html.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
        html = html.replace(/\\*(.*?)\\*/g, '<em>$1</em>');
        
        html = html.replace(/\\\`\\\`\\\`([\\\\s\\\\S]*?)\\\`\\\`\\\`/g, '<pre>$1</pre>');
        html = html.replace(/\\\`([^\\\`]+)\\\`/g, '<code>$1</code>');
        
        html = html.replace(/\\[([^\\]]+)\\]\\(([^\\)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');
    
        html = html.replace(/^\\* (.+)$/gim, '<li>$1</li>');
        html = html.replace(/^\\d+\\. (.+)$/gim, '<li>$1</li>');
        
        html = html.replace(/(<li>(?:.*?)<\\/li>)/sg, '<ul>$1</ul>');
        html = html.replace(/<\\/ul>\\s*<ul>/g, '');
        
        html = html.replace(/^> (.+)$/gim, '<blockquote>$1</blockquote>');
        html = html.replace(/\\n/g, '<br>');
        
        return html;
    }

    const saveNotesDebounced = debounce(() => {
        if (!currentReleaseName) return;
        
        const notes = document.getElementById('release-notes-input').value;
        
        fetch('/save-release-notes', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ branchName: currentReleaseName, notes })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const status = document.getElementById('notes-save-status');
                status.style.display = 'block';
                setTimeout(() => status.style.display = 'none', 2000);
            }
        })
        .catch(err => console.error('Failed to save notes:', err));
    }, 1000);

    document.addEventListener('DOMContentLoaded', () => {
        const notesInput = document.getElementById('release-notes-input');
        if (notesInput) {
            notesInput.addEventListener('input', saveNotesDebounced);
        }
    });

    function togglePRSection() {
        prSectionExpanded = !prSectionExpanded;
        const section = document.getElementById('pr-section');
        const btn = document.getElementById('pr-toggle-btn');
        
        if (prSectionExpanded) {
            section.style.maxHeight = '300px';
            btn.innerText = '▼';
        } else {
            section.style.maxHeight = '0';
            btn.innerText = '▶';
        }
    }

    async function loadPullRequests(forceRefresh = false) {
        const container = document.getElementById('pr-section');
        
        const now = Date.now();
        if (!forceRefresh && prCache.data && prCache.timestamp && (now - prCache.timestamp < PR_CACHE_DURATION)) {
            renderPullRequests(prCache.data);
            return;
        }
        
        container.innerHTML = '<div class="pr-loading">Loading pull requests...</div>';
        
        try {
            const response = await fetch('/pull-requests?branch=${branch2}');
            const data = await response.json();
            
            prCache = { data, timestamp: now };

            console.log('data1', data);
            
            renderPullRequests(data);
        } catch (error) {
            console.error('Failed to load pull requests:', error);
            container.innerHTML = '<div class="pr-empty" style="color: #de350b;">Failed to load PRs. <button class="pr-refresh-btn" onclick="loadPullRequests(true)">Retry</button></div>';
        }
    }

    function renderPullRequests(prs) {
        const container = document.getElementById('pr-section');
        
        if (!prs || prs.length === 0) {
            container.innerHTML = '<div class="pr-empty">No open pull requests found</div>';
            return;
        }
        
        const grouped = {
            active: prs.filter(pr => pr.status === 'active'),
            completed: prs.filter(pr => pr.status === 'completed'),
            abandoned: prs.filter(pr => pr.status === 'abandoned')
        };
        
        let html = '';
        
        if (grouped.active.length > 0) {
            html += renderPRGroup('Active', grouped.active, 'active', true);
        }
        
        if (grouped.completed.length > 0) {
            html += renderPRGroup('Completed', grouped.completed, 'completed', false);
        }
        
        if (grouped.abandoned.length > 0) {
            html += renderPRGroup('Abandoned', grouped.abandoned, 'abandoned', false);
        }
        
        container.innerHTML = html;
    }

    function renderPRGroup(title, prs, statusKey, defaultExpanded) {
        const statusClass = statusKey === 'active' ? 'pr-status-active' : 
                           statusKey === 'completed' ? 'pr-status-completed' : 'pr-status-abandoned';
        
        return \`
            <div class="pr-container">
                <div class="pr-header" onclick="togglePRGroup('pr-group-\${statusKey}')">
                    <div class="pr-title-section">
                        <span class="pr-expand-icon \${defaultExpanded ? 'expanded' : ''}" id="pr-icon-\${statusKey}">▶</span>
                        <strong>\${title}</strong>
                        <span class="pr-count-badge">\${prs.length}</span>
                    </div>
                    <button class="pr-refresh-btn" onclick="event.stopPropagation(); loadPullRequests(true)">↻</button>
                </div>
                <div class="pr-list \${defaultExpanded ? 'expanded' : ''}" id="pr-group-\${statusKey}">
                    \${prs.map(pr => renderPRItem(pr, statusClass)).join('')}
                </div>
            </div>
        \`;
    }

    function renderPRItem(pr, statusClass) {
        const createdDate = new Date(pr.createdDate).toLocaleDateString();
        const statusText = pr.status.charAt(0).toUpperCase() + pr.status.slice(1);
        
        return \`
            <div class="pr-item" oncontextmenu="showPRContextMenu(event, '\${pr.sourceBranch}', '\${pr.targetBranch}')">
                <div class="pr-item-header">
                    <div class="pr-item-title">\${escapeHtml(pr.title)}</div>
                    <span class="pr-status-badge \${statusClass}">\${statusText}</span>
                </div>
                <div class="pr-item-meta">
                    <div class="pr-meta-item">
                        <span>👤</span>
                        <span>\${escapeHtml(pr.author)}</span>
                    </div>
                    <div class="pr-meta-item">
                        <span>📅</span>
                        <span>\${createdDate}</span>
                    </div>
                    <div class="pr-meta-item">
                        <span class="pr-branch-badge">\${escapeHtml(pr.sourceBranch)}</span>
                        <span>→</span>
                        <span class="pr-branch-badge">\${escapeHtml(pr.targetBranch)}</span>
                    </div>
                </div>
                <div style="margin-top: 8px;">
                    <a href="\${pr.url}" target="_blank" class="pr-link-btn">View PR #\${pr.id} ↗</a>
                </div>
            </div>
        \`;
    }

    function togglePRGroup(groupId) {
        const group = document.getElementById(groupId);
        const icon = document.getElementById(groupId.replace('pr-group', 'pr-icon'));
        
        if (group.classList.contains('expanded')) {
            group.classList.remove('expanded');
            icon.classList.remove('expanded');
        } else {
            group.classList.add('expanded');
            icon.classList.add('expanded');
        }
    }

    init();
</script>
</body>
${fs.readFileSync(path.join(__dirname, 'conflict_resolution_ui.html'), 'utf8')}
</html>`;
}

// --- SERVER ---

const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('Usage: node script.js <source> <target>');
    process.exit(1);
}

(async () => {
    const [b1, b2] = args;
    console.log(`Analyzing commits...`);

    const rawCommits = getCommits(b1);
    const targetCommits = getCommits(b2);
    const targetMessages = new Set(targetCommits.map(c => c.message.trim()));
    const uniqueHashes = getUniqueHashesByContent(b2, b1);
    const candidates = rawCommits.filter(c => uniqueHashes.has(c.hash) && hasCodeChanges(c.hash) && !targetMessages.has(c.message.trim()));
    const processedCommits = processUniqueCommits(candidates, b2);

    // LOAD MAPPING
    const initialMapping = loadMapping();
    console.log(`Loaded ${Object.keys(initialMapping).length} tickets from ${MAPPING_FILE}`);

    const PORT = 8080;
    await killPort(PORT);
    await new Promise(resolve => setTimeout(resolve, 1000));

    const server = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url, true);
        const querySource = parsedUrl.query.source;
        const queryTarget = parsedUrl.query.target;

        const [currentB1, currentB2] = querySource && queryTarget
            ? [querySource, queryTarget]
            : [b1, b2];

        function stripHtml(html) {
            if (!html) return '';
            return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') 
                .replace(/<br\s*\/?>/gi, '\n') 
                .replace(/<\/p>/gi, '\n') 
                .replace(/<[^>]+>/g, '') 
                .replace(/&nbsp;/g, ' ')
                .replace(/\n\s*\n/g, '\n') 
                .trim();
        }

        if (req.method === 'GET' && parsedUrl.pathname === '/') {
            console.log(`\n📊 Analyzing commits: ${currentB1} → ${currentB2}`);
            
            const rawCommits = getCommits(currentB1);
            const targetCommits = getCommits(currentB2);
            const targetMessages = new Set(targetCommits.map(c => c.message.trim()));
            const uniqueHashes = getUniqueHashesByContent(currentB2, currentB1);
            const candidates = rawCommits.filter(c => 
                uniqueHashes.has(c.hash) && 
                hasCodeChanges(c.hash) && 
                !targetMessages.has(c.message.trim())
            );
            const processedCommits = processUniqueCommits(candidates, currentB2);
            
            console.log(`✅ Found ${processedCommits.length} unique commits for ${currentB1} → ${currentB2}`);
            
            const currentMapping = loadMapping();
            const availability = loadAvailability();
            
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(generateHTML(processedCommits, currentMapping, currentB1, currentB2, availability));
        }
        else if (req.method === 'POST' && parsedUrl.pathname === '/save-mapping') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                const data = JSON.parse(body);
                saveMapping(data);
                res.writeHead(200);
                res.end('Saved');
            });
        }
        else if (req.method === 'GET' && parsedUrl.pathname === '/get-conflict-state') {
            const conflictState = conflictResolution.loadConflictState();
            const isInConflict = conflictResolution.isInCherryPickConflict();
            
            if (conflictState && isInConflict) {
                // Update conflict state with current file contents
                const updatedState = conflictResolution.getConflictDetails();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, state: updatedState }));
            } else if (conflictState) {
                // State exists but not in conflict anymore (clean up)
                conflictResolution.clearConflictState();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'No active conflict' }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'No active conflict' }));
            }
        }
        else if (req.method === 'POST' && parsedUrl.pathname === '/resolve-conflict') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { filename, resolvedContent } = JSON.parse(body);
                    
                    if (!filename || resolvedContent === undefined) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'Missing filename or resolvedContent' }));
                        return;
                    }

                    const result = conflictResolution.resolveFileConflict(filename, resolvedContent);
                    
                    if (result.success) {
                        if (result.allResolved) {
                            // All conflicts resolved, continue cherry-pick
                            const conflictState = conflictResolution.loadConflictState();
                            
                            if (conflictState) {
                                // Continue with remaining commits if any
                                const remainingHashes = conflictState.selectedHashes.slice(conflictState.currentCommitIndex);
                                
                                if (remainingHashes.length > 0) {
                                    // Continue with remaining commits
                                    const branchName = conflictState.branchName;
                                    let additionalSuccessCount = 0;
                                    
                                    for (const hash of remainingHashes) {
                                        try {
                                            execSync(`git cherry-pick ${hash}`);
                                            additionalSuccessCount++;
                                            console.log(`✅ Successfully cherry-picked remaining ${hash.substring(0, 7)}`);
                                        } catch (err) {
                                            // Another conflict encountered
                                            const errorOutput = err.message || err.toString();
                                            if (errorOutput.includes('CONFLICT')) {
                                                console.log('⚠️ Another conflict detected during continuation');
                                                
                                                const newConflictingFiles = conflictResolution.getConflictingFiles();
                                                const newFileContents = {};
                                                
                                                newConflictingFiles.forEach(file => {
                                                    try {
                                                        newFileContents[file] = conflictResolution.getConflictContent(file);
                                                    } catch (error) {
                                                        newFileContents[file] = `Error reading file: ${error.message}`;
                                                    }
                                                });
                                                
                                                const updatedState = {
                                                    ...conflictState,
                                                    completedCommits: conflictState.completedCommits + additionalSuccessCount,
                                                    remainingCommits: remainingHashes.length - 1,
                                                    currentCommit: hash,
                                                    currentCommitIndex: conflictState.currentCommitIndex + additionalSuccessCount + 1,
                                                    conflictingFiles: newConflictingFiles,
                                                    fileContents: newFileContents,
                                                    timestamp: new Date().toISOString()
                                                };
                                                
                                                conflictResolution.saveConflictState(updatedState);
                                                
                                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                                res.end(JSON.stringify({ 
                                                    success: true, 
                                                    allResolved: false, 
                                                    remainingConflicts: newConflictingFiles 
                                                }));
                                                return;
                                            } else {
                                                execSync(`git cherry-pick --abort`);
                                                conflictResolution.clearConflictState();
                                                throw new Error(`Error continuing cherry-pick: ${errorOutput}`);
                                            }
                                        }
                                    }
                                    
                                    // All commits completed
                                    const totalSuccessCount = conflictState.completedCommits + additionalSuccessCount;
                                    const releases = loadReleases();
                                    
                                    if (releases[branchName]) {
                                        releases[branchName].commits = conflictState.selectedHashes.slice(0, totalSuccessCount);
                                        saveReleases(releases);
                                    } else {
                                        releases[branchName] = {
                                            created: new Date().toISOString(),
                                            base: conflictState.baseBranch,
                                            commits: conflictState.selectedHashes.slice(0, totalSuccessCount),
                                            notes: ''
                                        };
                                        saveReleases(releases);
                                    }
                                    
                                    conflictResolution.clearConflictState();
                                    
                                    res.writeHead(200, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ success: true, allResolved: true }));
                                } else {
                                    // No remaining commits, just save the final state
                                    const releases = loadReleases();
                                    const branchName = conflictState.branchName;
                                    
                                    if (releases[branchName]) {
                                        releases[branchName].commits = conflictState.selectedHashes;
                                        saveReleases(releases);
                                    } else {
                                        releases[branchName] = {
                                            created: new Date().toISOString(),
                                            base: conflictState.baseBranch,
                                            commits: conflictState.selectedHashes,
                                            notes: ''
                                        };
                                        saveReleases(releases);
                                    }
                                    
                                    conflictResolution.clearConflictState();
                                    
                                    res.writeHead(200, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ success: true, allResolved: true }));
                                }
                            } else {
                                res.writeHead(500, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ success: false, error: 'No conflict state found' }));
                            }
                        } else {
                            // More conflicts to resolve
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ 
                                success: true, 
                                allResolved: false, 
                                remainingConflicts: result.remainingConflicts 
                            }));
                        }
                    } else {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: result.error }));
                    }
                } catch (error) {
                    console.error('Error in /resolve-conflict:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: error.message }));
                }
            });
        }
        else if (req.method === 'POST' && parsedUrl.pathname === '/abort-cherry-pick') {
            try {
                const result = conflictResolution.abortCherryPick();
                
                if (result.success) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Cherry-pick aborted successfully' }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: result.error }));
                }
            } catch (error) {
                console.error('Error in /abort-cherry-pick:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        }
        else if (req.method === 'GET' && parsedUrl.pathname === '/get-cherry-pick-diff') {
            const hash = parsedUrl.query.hash;
            
            if (!hash) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Missing commit hash' }));
                return;
            }
            
            try {
                const diff = conflictResolution.getCherryPickDiff(hash);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, data: diff }));
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        }
        // NEW ENDPOINT: Toggle Availability
        else if (req.method === 'POST' && parsedUrl.pathname === '/toggle-availability') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                const { targetBranch, hash, status } = JSON.parse(body);
                const data = loadAvailability();
                
                if (!data[targetBranch]) data[targetBranch] = {};
                
                if (status === 'unavailable') {
                    data[targetBranch][hash] = 'unavailable';
                } else {
                    if (data[targetBranch]) delete data[targetBranch][hash];
                }
                
                saveAvailability(data);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            });
        }
        else if (req.method === 'GET' && parsedUrl.pathname === '/lookup-ticket') {
            const id = parsedUrl.query.id;
            try {
                const data = await adoRequest(`/_apis/wit/workitems/${id}?fields=System.Title,System.State&api-version=7.1`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    title: data.fields?.['System.Title'],
                    state: data.fields?.['System.State']
                }));
            } catch (e) {
                console.log("error", e);
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Not Found' }));
            }
        }
        else if (req.method === 'GET' && parsedUrl.pathname === '/search-tickets') {
            const term = parsedUrl.query.q;
            try {
                const results = await searchTicketsByTitle(term);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(results));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify([]));
            }
        }
        else if (req.method === 'POST' && parsedUrl.pathname === '/create-release') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                const payload = JSON.parse(body);
                const { branchName, hashes, baseBranch, sourceBranch, force } = payload;

                if (sourceBranch && !force) {
                    console.log(`🛡️ Running Dependency Safety Check...`);
                    const risks = analyzeDependencyRisks(hashes, sourceBranch, baseBranch);
                    
                    if (risks.length > 0) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ 
                            success: false, 
                            requiresConfirmation: true,
                            risks: risks,
                            message: `Found ${risks.length} potential dependency risks.` 
                        }));
                        return; 
                    }
                }

                const result = executeCherryPick(branchName, hashes, baseBranch);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            });
        }
        else if (req.method === 'GET' && parsedUrl.pathname === '/get-releases') {
            const releases = loadReleases();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(releases));
        }
        else if (req.method === 'GET' && parsedUrl.pathname === '/pull-requests') {
            const targetBranch = parsedUrl.query.branch || 'develop';
            const prs = await getPullRequests(targetBranch);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(prs));
        }
        else if (req.method === 'GET' && parsedUrl.pathname === '/get-branches') {
            const shouldFetch = parsedUrl.query.refresh === 'true';
            try {
                if (shouldFetch) {
                    console.log('🔄 Fetching latest branches...');
                    execSync('git fetch origin --prune', { stdio: 'ignore' }); 
                }
                const output = execSync('git branch -r', { encoding: 'utf-8' });
                const branches = output.split('\n')
                    .map(b => b.trim().replace('origin/', ''))
                    .filter(b => b && !b.includes('->') && !b.includes('HEAD'));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(branches));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify([]));
            }
        }
        else if (req.method === 'POST' && parsedUrl.pathname === '/append-release') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                const { branchName, hashes } = JSON.parse(body);
                const result = appendToRelease(branchName, hashes);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            });
        }
        else if (req.method === 'POST' && parsedUrl.pathname === '/delete-release') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                const { branchName } = JSON.parse(body);
                const releases = loadReleases();
                if (releases[branchName]) {
                    delete releases[branchName];
                    saveReleases(releases);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: `Release ${branchName} deleted from history.` }));
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Release not found.' }));
                }
            });
        } else if (req.method === 'POST' && parsedUrl.pathname === '/get-ticket-details-bulk') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                const { ids } = JSON.parse(body);
                try {
                    const promises = ids.map(id =>
                        adoRequest(`/_apis/wit/workitems/${id}?fields=System.Title,System.Description,System.State,System.WorkItemType&api-version=7.1`)
                            .catch(e => null)
                    );

                    const results = await Promise.all(promises);

                    const cleanedData = results.filter(r => r).map(item => ({
                        id: item.id,
                        type: item.fields['System.WorkItemType'],
                        title: item.fields['System.Title'],
                        description: stripHtml(item.fields['System.Description'] || 'No description provided.')
                    }));

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, data: cleanedData }));
                } catch (e) {
                    console.error("Batch Fetch Error", e);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
        } else if (req.method === 'GET' && parsedUrl.pathname === '/get-commit-body') {
            const hash = parsedUrl.query.hash;
            try {
                const output = execSync(`git show -s --format=%B ${hash}`, { encoding: 'utf-8' });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, data: output }));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: e.message }));
            }
        } else if (req.method === 'GET' && parsedUrl.pathname === '/get-pr-diff') {
            const source = parsedUrl.query.source;
            const target = parsedUrl.query.target;
            try {
                execSync(`git fetch origin ${source} ${target}`);
                const diff = execSync(`git diff origin/${target}...origin/${source}`, { 
                    encoding: 'utf-8', 
                    maxBuffer: 1024 * 1024 * 50 // 50MB buffer for large PRs
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, data: diff }));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: e.message }));
            }
        }
        else if (req.method === 'POST' && parsedUrl.pathname === '/save-release-notes') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                const { branchName, notes } = JSON.parse(body);
                const releases = loadReleases();
                
                if (releases[branchName]) {
                    releases[branchName].notes = notes;
                    saveReleases(releases);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Release not found' }));
                }
            });
        }
    });

    server.listen(PORT, () => {
        const url = `http://localhost:${PORT}`;
        console.log(`\n✅ Server started at ${url}`);
        console.log(`📌 Initial branches: ${b1} → ${b2}`);
        setTimeout(() => openBrowser(url), 500);
    });
})();