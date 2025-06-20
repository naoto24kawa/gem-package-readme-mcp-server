import { logger } from '../utils/logger.js';
import { validateSearchQuery, validateLimit, validateScore } from '../utils/validators.js';
import { cache, createCacheKey } from '../services/cache.js';
import { rubygemsApi } from '../services/rubygems-api.js';
import {
  SearchPackagesParams,
  SearchPackagesResponse,
  PackageSearchResult,
} from '../types/index.js';

export async function searchPackages(params: SearchPackagesParams): Promise<SearchPackagesResponse> {
  const { 
    query, 
    limit = 20, 
    quality,
    popularity 
  } = params;

  logger.info(`Searching gems: "${query}" (limit: ${limit})`);

  // Validate inputs
  validateSearchQuery(query);
  validateLimit(limit);
  
  if (quality !== undefined) {
    validateScore(quality, 'Quality');
  }
  
  if (popularity !== undefined) {
    validateScore(popularity, 'Popularity');
  }

  // Check cache first
  const cacheKey = createCacheKey.searchResults(query, limit, popularity, quality);
  const cached = cache.get<SearchPackagesResponse>(cacheKey);
  if (cached) {
    logger.debug(`Cache hit for search: "${query}"`);
    return cached;
  }

  try {
    // Search gems using RubyGems API
    const searchResults = await rubygemsApi.searchGems(query, limit);
    
    // Transform results to our format
    let packages: PackageSearchResult[] = searchResults.map(gem => {
      // Calculate a simple score based on downloads (popularity score)
      let popularityScore = 0;
      if (gem.downloads > 0) {
        // Normalize downloads to a 0-1 scale (rough approximation)
        // Popular gems can have millions of downloads
        popularityScore = Math.min(gem.downloads / 10000000, 1);
      }

      // Calculate quality score (simplified - based on presence of metadata)
      let qualityScore = 0.5; // base score
      if (gem.documentation_uri) qualityScore += 0.1;
      if (gem.source_code_uri) qualityScore += 0.1;
      if (gem.homepage_uri) qualityScore += 0.1;
      if (gem.licenses && gem.licenses.length > 0) qualityScore += 0.1;
      if (gem.info && gem.info.length > 50) qualityScore += 0.1; // decent description
      qualityScore = Math.min(qualityScore, 1);

      return {
        name: gem.name,
        version: gem.version,
        description: gem.info || 'No description available',
        authors: gem.authors,
        licenses: gem.licenses || [],
        downloads: gem.downloads,
        version_downloads: gem.version_downloads,
        homepage_uri: gem.homepage_uri,
        project_uri: gem.project_uri,
        gem_uri: gem.gem_uri,
        documentation_uri: gem.documentation_uri,
        source_code_uri: gem.source_code_uri,
        score: popularityScore,
        quality_score: qualityScore,
      };
    });

    // Filter results based on quality if specified
    if (quality !== undefined) {
      packages = packages.filter(pkg => (pkg.quality_score || 0) >= quality);
    }

    // Filter results based on popularity if specified
    if (popularity !== undefined) {
      packages = packages.filter(pkg => (pkg.score || 0) >= popularity);
    }

    // Sort by downloads (popularity) in descending order
    packages.sort((a, b) => b.downloads - a.downloads);

    // Limit results
    packages = packages.slice(0, limit);

    // Create response
    const response: SearchPackagesResponse = {
      query,
      total: packages.length,
      packages,
    };

    // Cache the response (shorter TTL for search results)
    cache.set(cacheKey, response, 600000); // 10 minutes

    logger.info(`Successfully searched gems: "${query}", found ${response.total} results`);
    return response;

  } catch (error) {
    logger.error(`Failed to search gems: "${query}"`, { error });
    throw error;
  }
}