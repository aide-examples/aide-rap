/**
 * ExternalQueryService
 * Config-driven service for querying external REST APIs.
 * Provider definitions are loaded from app/api_providers.json.
 */

const path = require('path');
const logger = require('../utils/logger');

// Load provider definitions from JSON config
const providersPath = path.join(__dirname, '..', '..', 'api_providers.json');
let PROVIDERS = {};
try {
  PROVIDERS = require(providersPath);
} catch (err) {
  logger.warn('No api_providers.json found — external queries disabled');
}

const TIMEOUT_MS = 10000;

/**
 * Build the request URL for a provider, substituting ${term} in param values.
 */
function buildUrl(provider, searchTerm, page) {
  const params = new URLSearchParams();
  const pageParam = provider.pagination?.pageParam || 'page';

  for (const [key, value] of Object.entries(provider.params || {})) {
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else {
      params.set(key, String(value).replace('${term}', searchTerm));
    }
  }
  params.set(pageParam, String(page));

  return `${provider.baseUrl}?${params.toString()}`;
}

/**
 * Map a raw API result object using the provider's resultMapping config.
 */
function mapResult(doc, mapping) {
  const result = {};
  for (const [outKey, sourceKey] of Object.entries(mapping || {})) {
    result[outKey] = doc[sourceKey] || '';
  }
  return result;
}

/**
 * Query an external API provider.
 * @param {string} providerId - Provider key from api_providers.json
 * @param {string} searchTerm - Search term
 * @param {number} [page=1] - Page number for pagination
 * @returns {Promise<{results: Object[], totalCount: number, hasMore: boolean}>}
 */
async function query(providerId, searchTerm, page = 1) {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Unknown external query provider: ${providerId}`);
  }

  const url = buildUrl(provider, searchTerm, page);
  logger.debug('External query', { provider: providerId, term: searchTerm, page, url });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('External API request timed out');
    }
    throw new Error(`External API request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`External API returned HTTP ${response.status}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error('External API returned invalid JSON');
  }

  const results = (data.results || []).map(doc => mapResult(doc, provider.resultMapping));
  const pag = provider.pagination || {};
  const totalCount = data[pag.totalCountField || 'total_count'] || data.count || results.length;
  const hasMore = pag.hasMoreField ? !!data[pag.hasMoreField] : false;

  logger.debug('External query results', { provider: providerId, count: results.length, totalCount });

  return { results, totalCount, hasMore };
}

/**
 * Get list of available provider IDs and their metadata.
 */
function getProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    name: p.name || id,
    description: p.description || ''
  }));
}

module.exports = { query, getProviders };
