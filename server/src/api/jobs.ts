import { Router } from 'express';
import mongoose from 'mongoose';
import { requireSignInOrApiKey } from '../middlewares/auth';
import Robot from '../models/Robot';
import ExtractedData from '../models/ExtractedData';
import logger from '../logger';
import {
  applyReadPipelineToExtractedData,
  getAutomationConfig,
} from '../services/automation';
import { ownerIdFilter } from '../utils/ownerId';

const router = Router();

router.use(requireSignInOrApiKey);

type OwnedRobot = {
  recording_meta: { id: string; name?: string; saasConfig?: Record<string, any> };
};

async function loadOwnedRobots(userId: unknown): Promise<OwnedRobot[]> {
  return Robot.find(ownerIdFilter(userId))
    .select('recording_meta.id recording_meta.name recording_meta.saasConfig')
    .lean();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mapJobRow(
  row: any,
  robotById: Map<string, OwnedRobot>
): {
  id: string;
  runId: string;
  robotMetaId: string;
  scraperName: string;
  source: string;
  createdAt: Date;
  data: Record<string, any>;
} {
  const robot = robotById.get(row.robotMetaId);
  const cfg = robot ? getAutomationConfig(robot as any) : { columnOverrides: {}, rowContext: {} };
  return {
    id: row._id?.toString?.() || String(row.id),
    runId: row.runId,
    robotMetaId: row.robotMetaId,
    scraperName: robot?.recording_meta?.name || 'Unknown scraper',
    source: row.source,
    createdAt: row.createdAt,
    data: applyReadPipelineToExtractedData(
      row.data,
      row.createdAt ? new Date(row.createdAt) : new Date(),
      cfg.columnOverrides,
      cfg.rowContext
    ),
  };
}

/**
 * GET /api/jobs — paginated jobs across all scrapers owned by the caller.
 * Query: page, limit, q, company, category, robotMetaId
 */
router.get('/jobs', async (req: any, res: any) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const offset = (page - 1) * limit;
    const q = String(req.query.q || '').trim();
    const company = String(req.query.company || '').trim();
    const category = String(req.query.category || '').trim();
    const robotMetaIdFilter = String(req.query.robotMetaId || '').trim();

    const robots = await loadOwnedRobots(req.user.id);
    const allowedIds = robots.map((r) => r.recording_meta.id).filter(Boolean);
    const robotById = new Map(robots.map((r) => [r.recording_meta.id, r]));

    if (allowedIds.length === 0) {
      return res.json({
        pagination: { page, limit, total: 0, totalPages: 1 },
        jobs: [],
        filters: { companies: [], categories: [], scrapers: [] },
      });
    }

    if (robotMetaIdFilter && !robotById.has(robotMetaIdFilter)) {
      return res.status(404).json({ error: 'Scraper not found' });
    }

    const match: Record<string, any> = {
      robotMetaId: robotMetaIdFilter
        ? robotMetaIdFilter
        : { $in: allowedIds },
    };

    const andClauses: Record<string, any>[] = [];
    if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      andClauses.push({
        $or: [
          { 'data.jobTitle': re },
          { 'data.companyName': re },
          { 'data.location': re },
          { 'data.jobDescription': re },
        ],
      });
    }
    if (company) {
      andClauses.push({ 'data.companyName': new RegExp(`^${escapeRegex(company)}$`, 'i') });
    }
    if (category) {
      andClauses.push({ 'data.jobCategory': new RegExp(`^${escapeRegex(category)}$`, 'i') });
    }
    if (andClauses.length > 0) {
      match.$and = andClauses;
    }

    const facetMatch = {
      robotMetaId: { $in: allowedIds },
    };

    const [total, rows, companyFacets, categoryFacets] = await Promise.all([
      ExtractedData.countDocuments(match),
      ExtractedData.find(match)
        .select('runId robotMetaId source createdAt data')
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      ExtractedData.aggregate([
        { $match: facetMatch },
        { $group: { _id: '$data.companyName', count: { $sum: 1 } } },
        { $match: { _id: { $nin: [null, ''] } } },
        { $sort: { count: -1 } },
        { $limit: 40 },
      ]),
      ExtractedData.aggregate([
        { $match: facetMatch },
        { $group: { _id: '$data.jobCategory', count: { $sum: 1 } } },
        { $match: { _id: { $nin: [null, ''] } } },
        { $sort: { count: -1 } },
        { $limit: 40 },
      ]),
    ]);

    const jobs = rows.map((row) => mapJobRow(row, robotById));
    const scrapers = robots
      .map((r) => ({
        id: r.recording_meta.id,
        name: r.recording_meta.name || r.recording_meta.id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.json({
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 1 : Math.ceil(total / limit),
      },
      jobs,
      filters: {
        companies: companyFacets.map((f: any) => String(f._id)).filter(Boolean),
        categories: categoryFacets.map((f: any) => String(f._id)).filter(Boolean),
        scrapers,
      },
    });
  } catch (error: any) {
    logger.log('error', `Failed to fetch jobs: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

/**
 * GET /api/jobs/:id — single extracted job row with ownership check.
 */
router.get('/jobs/:id', async (req: any, res: any) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const row: any = await ExtractedData.findById(id)
      .select('runId robotMetaId source createdAt data')
      .lean();

    if (!row) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const robot: any = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.id': row.robotMetaId,
    })
      .select('recording_meta.id recording_meta.name recording_meta.saasConfig')
      .lean();

    if (!robot) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const robotById = new Map<string, OwnedRobot>([[robot.recording_meta.id, robot]]);
    return res.json({ job: mapJobRow(row, robotById) });
  } catch (error: any) {
    logger.log('error', `Failed to fetch job ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch job' });
  }
});

export default router;
