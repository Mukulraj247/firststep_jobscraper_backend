import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import { detectAtsBoard, fetchAtsBoardJobs } from '../services/atsAdapters';
import { resolveAtsBoardStartUrl } from '../services/careerSiteAtsConfig';

const URLS: Array<[string, string]> = [
  ['wells', 'https://www.wellsfargojobs.com/en/jobs/?search=&country=United+States+of+America&team=Technology&pagesize=20#results'],
  ['intuit', 'https://jobs.intuit.com/search-jobs'],
  ['circle', 'https://careers.circle.com/us/en/search-results?keywords=engineering'],
  ['travelers', 'https://careers.travelers.com/job-search-results/?keyword=Software%20Engineer&location=United%20States&country=US&radius=25&nationwide=US'],
  ['edwardjones', 'https://careers.edwardjones.com/job-search-results/?keyword=developer&location=United%20States&country=US&radius=25&units=km#'],
  ['spglobal', 'https://careers.spglobal.com/jobs?location=United%20States&categories=Analytics%7CInformation%20Technology&page=1'],
  ['principal', 'https://careers.principal.com/careers-home/jobs?location=United%20States&categories=Engineering%20%26%20Technology&page=1'],
  ['usaa', 'https://www.usaajobs.com/search-jobs/technology/United%20States/1207/1/2/6252001/39x76/-98x5/50/2'],
  ['hexaware', 'https://jobs.hexaware.com/#en/sites/CX_1/jobs?keyword=technology&location=United+States&locationId=300000000446660&locationLevel=country&mode=location'],
];

async function main() {
  for (const [name, url] of URLS) {
    const start = resolveAtsBoardStartUrl(url).url;
    const d = detectAtsBoard(start);
    process.stdout.write(`\n${name}: ${d?.provider || 'none'} `);
    try {
      const r = await fetchAtsBoardJobs(start, { maxPages: 1, maxItems: 3 });
      console.log(r ? `n=${r.rows.length} ${r.rows[0]?.jobTitle}` : 'NULL');
    } catch (e: any) {
      console.log('ERR', String(e.message).slice(0, 120));
    }
  }
}
main();
