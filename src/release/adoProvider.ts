import * as https from 'https';

export interface Ticket {
    id: string;
    title: string;
    state: string;
    type?: string;
    description?: string;
}

interface ADOWorkItemResponse {
    id: number;
    fields: {
        'System.Title': string;
        'System.State': string;
        'System.WorkItemType'?: string;
        'System.Description'?: string;
    };
}

interface ADOWiqlResponse {
    workItems: Array<{ id: number; url: string }>;
}

interface ADOValueResponse<T> {
    value: T[];
}

interface ADOPullRequestResponse {
    pullRequestId: number;
    title: string;
    createdBy: { displayName: string; uniqueName: string };
    sourceRefName: string;
    targetRefName: string;
    status: string;
    creationDate: string;
    closedDate: string;
    mergeStatus: string;
}

export interface PR {
    id: number;
    title: string;
    author: string;
    authorEmail: string;
    sourceBranch: string;
    targetBranch: string;
    status: string;
    createdDate: string;
    closedDate: string;
    mergeStatus: string;
    url: string;
}

export class ADOProvider {
    private orgUrl: string;
    private project: string;
    private token: string;
    private repoId: string;

    constructor(orgUrl: string, project: string, token: string, repoId: string) {
        this.orgUrl = orgUrl;
        this.project = project;
        this.token = token;
        this.repoId = repoId;
    }

    private adoRequest<T = any>(apiPath: string, method: string = 'GET', body: Record<string, any> | null = null): Promise<T> {
        return new Promise((resolve, reject) => {
            const authHeader = 'Basic ' + Buffer.from(':' + this.token).toString('base64');
            
            let hostname: string;
            let orgName: string;

            try {
                const url = new URL(this.orgUrl);
                hostname = url.hostname;
                // Get the organization name from the pathname (handles trailing slashes and sub-paths)
                const pathParts = url.pathname.split('/').filter(Boolean);
                orgName = pathParts.length > 0 ? pathParts[pathParts.length - 1] : '';
            } catch (e) {
                // Fallback for older formats if URL parsing fails
                // Improved fallback to handle potential sub-paths more safely
                const stripped = this.orgUrl.replace(/^https?:\/\//, '');
                const parts = stripped.split('/').filter(Boolean);
                hostname = parts[0] || '';
                orgName = parts.length > 1 ? parts[parts.length - 1] : '';
            }

            const options = {
                hostname: hostname,
                path: `/${orgName}${apiPath}`,
                method: method,
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30 seconds timeout
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (res.statusCode && res.statusCode >= 400) {
                            const message = json.message || json.errorCode || `HTTP ${res.statusCode}`;
                            reject(new Error(`ADO API Error: ${message}`));
                        } else {
                            resolve(json);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse ADO response: ${e}`));
                    }
                });
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('ADO API request timed out (30s)'));
            });

            req.on('error', (e) => reject(new Error(`ADO Request failed: ${e.message}`)));
            if (body) {req.write(JSON.stringify(body));}
            req.end();
        });
    }

    public async lookupTicket(id: string): Promise<Ticket> {
        // Basic numeric ID validation
        if (!/^\d+$/.test(id)) {
            throw new Error('Invalid ticket ID format');
        }
        const data = await this.adoRequest<ADOWorkItemResponse>(`/_apis/wit/workitems/${id}?fields=System.Title,System.State,System.WorkItemType,System.Description&api-version=7.1`);
        return {
            id: data.id.toString(),
            title: data.fields['System.Title'],
            state: data.fields['System.State'],
            type: data.fields['System.WorkItemType'],
            description: data.fields['System.Description']
        };
    }

    public async searchTicketsByTitle(term: string): Promise<Ticket[]> {
        // Security Fix: Restrictive sanitization of project and term to prevent WIQL injection
        // Added length limit and more restrictive pattern
        if (term.length > 100) {
            term = term.substring(0, 100);
        }
        const sanitizedProject = this.project.replace(/[^a-zA-Z0-9\s-_]/g, '').replace(/'/g, "''");
        const sanitizedTerm = term.replace(/[^a-zA-Z0-9\s-_]/g, '').replace(/'/g, "''");
        
        if (!sanitizedProject || !sanitizedTerm) {
            return [];
        }

        const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${sanitizedProject}' AND [System.Title] CONTAINS '${sanitizedTerm}' AND [System.State] <> 'Closed' ORDER BY [System.ChangedDate] DESC`;
        try {
            const searchResult = await this.adoRequest<ADOWiqlResponse>(`/_apis/wit/wiql?api-version=6.0`, 'POST', { 
                query: wiql
            });
            const workItems = searchResult.workItems || [];

            if (workItems.length === 0) {return [];}

            const ids = workItems.slice(0, 10).map(i => i.id).join(',');
            const details = await this.adoRequest<ADOValueResponse<ADOWorkItemResponse>>(`/_apis/wit/workitems?ids=${ids}&fields=System.Id,System.Title,System.State&api-version=6.0`, 'GET');

            return details.value.map(item => ({
                id: item.id.toString(),
                title: item.fields['System.Title'],
                state: item.fields['System.State']
            }));
        } catch (e: unknown) {
            console.error("[ADOProvider] Search Error:", e instanceof Error ? e.message : e);
            throw e;
        }
    }

    public async getPullRequests(targetBranch: string): Promise<PR[]> {
        try {
            const apiPath = `/${encodeURIComponent(this.project)}/_apis/git/repositories/${encodeURIComponent(this.repoId)}/pullrequests?searchCriteria.status=all&searchCriteria.targetRefName=refs/heads/${encodeURIComponent(targetBranch)}&api-version=7.0`;
            const response = await this.adoRequest<ADOValueResponse<ADOPullRequestResponse>>(apiPath);
            
            if (!response.value) {return [];}
            
            return response.value.map((pr: ADOPullRequestResponse) => ({
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
                url: `${this.orgUrl}/${encodeURIComponent(this.project)}/_git/${encodeURIComponent(this.repoId)}/pullrequest/${pr.pullRequestId}`
            }));
        } catch (error) {
            console.error('[ADOProvider] Error fetching Azure DevOps PRs:', error);
            return [];
        }
    }

    public async getTicketDetailsBulk(ids: string[]): Promise<Ticket[]> {
        const validIds = ids.filter(id => /^\d+$/.test(id));
        if (validIds.length === 0) {return [];}
        try {
            const idString = validIds.join(',');
            const details = await this.adoRequest<ADOValueResponse<ADOWorkItemResponse>>(`/_apis/wit/workitems?ids=${idString}&fields=System.Id,System.Title,System.State,System.WorkItemType,System.Description&api-version=6.0`, 'GET');
            return details.value.map(item => ({
                id: item.id.toString(),
                title: item.fields['System.Title'],
                state: item.fields['System.State'],
                type: item.fields['System.WorkItemType'],
                description: item.fields['System.Description']
            }));
        } catch (e) {
            console.error("[ADOProvider] Bulk Lookup Error:", e);
            return [];
        }
    }
}
