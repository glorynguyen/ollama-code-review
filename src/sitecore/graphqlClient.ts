/**
 * F-050: Sitecore Layout Service Schema Validation — GraphQL Client
 *
 * Calls the Sitecore Experience Edge GraphQL endpoint to fetch layout data
 * for a given route path. Parses the response into structured component schemas.
 */
import axios from 'axios';
import type { LayoutServiceResponse, SitecoreEnvConfig } from './types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches layout data from Sitecore Experience Edge for a given route.
 *
 * @param envConfig  Detected or configured Sitecore connection details
 * @param routePath  The route path to fetch (e.g. "/bento-grid")
 * @param language   Language code (default: "en")
 * @returns The parsed Layout Service response, or null on error
 */
export async function fetchLayoutServiceData(
	envConfig: SitecoreEnvConfig,
	routePath: string,
	language: string = 'en',
): Promise<LayoutServiceResponse | null> {
	const { query, variables } = buildLayoutQuery(envConfig.siteName, routePath, language);

	try {
		const response = await axios.post(
			envConfig.graphqlEndpoint,
			{ query, variables },
			{
				headers: {
					'Content-Type': 'application/json',
					'sc_apikey': envConfig.apiKey,
				},
				timeout: 15000,
			},
		);

		const data = response.data;

		// Handle GraphQL errors
		if (data.errors && data.errors.length > 0) {
			const errorMsg = data.errors.map((e: { message: string }) => e.message).join('; ');
			throw new Error(`GraphQL error: ${errorMsg}`);
		}

		// Extract the rendered layout
		const rendered = data?.data?.layout?.item?.rendered;
		if (!rendered) {
			return null;
		}

		// The rendered field may be a string (needs parsing) or already an object
		if (typeof rendered === 'string') {
			return JSON.parse(rendered) as LayoutServiceResponse;
		}

		return rendered as LayoutServiceResponse;
	} catch (error: unknown) {
		if (axios.isAxiosError(error)) {
			const status = error.response?.status;
			if (status === 401 || status === 403) {
				throw new Error('Authentication failed. Check your SITECORE_API_KEY.');
			}
			if (status === 404) {
				throw new Error(`Route "${routePath}" not found.`);
			}
			throw new Error(`HTTP ${status}: ${error.message}`);
		}
		throw error;
	}
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

/**
 * Builds the GraphQL query string for Layout Service using parameterized variables.
 */
export function buildLayoutQuery(
	siteName: string,
	routePath: string,
	language: string = 'en',
): { query: string; variables: Record<string, string> } {
	const query = `query LayoutQuery($site: String!, $routePath: String!, $language: String!) {
  layout(site: $site, routePath: $routePath, language: $language) {
    item {
      rendered
    }
  }
}`;

	return {
		query,
		variables: { site: siteName, routePath, language },
	};
}
