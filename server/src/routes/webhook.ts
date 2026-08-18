import { Router, Request, Response } from 'express';
import Robot from '../models/Robot';
import { requireSignIn } from '../middlewares/auth';
import { v4 as uuid } from "uuid";
import { postJsonWithRetry } from '../services/destinations';
import { safeOutboundUrlLogLabel } from '../utils/outboundUrlPolicy';
import {
    resolveStoredLegacyWebhookSettings,
    validateLegacyWebhookSettings,
} from '../utils/webhookDeliverySettings';

export const router = Router();

interface AuthenticatedRequest extends Request {
    user?: { id: string };
}

interface WebhookConfig {
    id: string;
    url: string;
    events: string[];
    active: boolean;
    createdAt: string;
    updatedAt: string;
    lastCalledAt?: string | null;
    retryAttempts?: number;
    retryDelay?: number;
    timeout?: number;
}

const updateWebhookLastCalled = async (robotId: string, webhookId: string): Promise<void> => {
    try {
        const robot = await Robot.findOne({ 'recording_meta.id': robotId });
        if (!robot || !robot.webhooks) {
            return;
        }

        const updatedWebhooks = robot.webhooks.map((w: WebhookConfig) => {
            if (w.id === webhookId) {
                return {
                    ...w,
                    lastCalledAt: new Date().toISOString()
                };
            }
            return w;
        });

        robot.webhooks = updatedWebhooks;
        await robot.save();
    } catch (error) {
        console.error('Error updating webhook lastCalledAt:', error);
    }
};

// Add new webhook
router.post('/add', requireSignIn, async (req: Request, res: Response) => {
    const { webhook, robotId } = req.body;
    const authenticatedReq = req as AuthenticatedRequest;

    try {
        if (!authenticatedReq.user) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }

        if (!webhook || !robotId) {
            return res.status(400).json({ ok: false, error: 'Webhook configuration and robot ID are required' });
        }

        if (!webhook.url) {
            return res.status(400).json({ ok: false, error: 'Webhook URL is required' });
        }
        validateLegacyWebhookSettings(webhook);

        // Validate URL format
        try {
            new URL(webhook.url);
        } catch (error) {
            return res.status(400).json({ ok: false, error: 'Invalid webhook URL format' });
        }

        const robot = await Robot.findOne({ 'recording_meta.id': robotId });

        if (!robot) {
            return res.status(404).json({ ok: false, error: 'Robot not found' });
        }

        const currentWebhooks = robot.webhooks || [];
        
        const existingWebhook = currentWebhooks.find((w: WebhookConfig) => w.url === webhook.url);
        if (existingWebhook) {
            return res.status(400).json({ ok: false, error: 'Webhook with this url already exists' });
        }

        const deliverySettings = resolveStoredLegacyWebhookSettings(webhook);
        const newWebhook: WebhookConfig = {
            ...webhook,
            id: webhook.id || uuid(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastCalledAt: null, 
            ...deliverySettings,
        };

        const updatedWebhooks = [...currentWebhooks, newWebhook];
        
        robot.webhooks = updatedWebhooks;
        await robot.save();

        res.status(200).json({ 
            ok: true, 
            message: 'Webhook added successfully',
            webhook: newWebhook
        });
    } catch (error: any) {
        if (error instanceof RangeError) {
            return res.status(400).json({ ok: false, error: error.message });
        }
        console.log(`Could not add webhook - ${error}`);
        res.status(500).json({ ok: false, error: 'Could not add webhook configuration' });
    }
});

// Update existing webhook
router.post('/update', requireSignIn, async (req: Request, res: Response) => {
    const { webhook, robotId } = req.body;
    const authenticatedReq = req as AuthenticatedRequest;

    try {
        if (!authenticatedReq.user) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }

        if (!webhook || !robotId || !webhook.id) {
            return res.status(400).json({ ok: false, error: 'Webhook configuration, webhook ID, and robot ID are required' });
        }
        validateLegacyWebhookSettings(webhook);

        // Validate URL format if provided
        if (webhook.url) {
            try {
                new URL(webhook.url);
            } catch (error) {
                return res.status(400).json({ ok: false, error: 'Invalid webhook URL format' });
            }
        }

        const robot = await Robot.findOne({ 'recording_meta.id': robotId });

        if (!robot) {
            return res.status(404).json({ ok: false, error: 'Robot not found' });
        }

        const currentWebhooks = robot.webhooks || [];
        const webhookIndex = currentWebhooks.findIndex((w: WebhookConfig) => w.id === webhook.id);

        if (webhookIndex === -1) {
            return res.status(404).json({ ok: false, error: 'Webhook not found' });
        }

        // Check for duplicate URLs (excluding current webhook)
        const duplicateUrl = currentWebhooks.find((w: WebhookConfig, index: number) => 
            w.url === webhook.url && index !== webhookIndex
        );
        if (duplicateUrl) {
            return res.status(400).json({ ok: false, error: 'Webhook with this URL already exists' });
        }

        const updatedWebhook: WebhookConfig = {
            ...currentWebhooks[webhookIndex],
            ...webhook,
            updatedAt: new Date().toISOString(),
            lastCalledAt: currentWebhooks[webhookIndex].lastCalledAt
        };

        const updatedWebhooks = [...currentWebhooks];
        updatedWebhooks[webhookIndex] = updatedWebhook;

        robot.webhooks = updatedWebhooks;
        await robot.save();

        res.status(200).json({ 
            ok: true, 
            message: 'Webhook updated successfully',
            webhook: updatedWebhook
        });
    } catch (error: any) {
        if (error instanceof RangeError) {
            return res.status(400).json({ ok: false, error: error.message });
        }
        console.log(`Could not update webhook - ${error}`);
        res.status(500).json({ ok: false, error: 'Could not update webhook configuration' });
    }
});

// Remove webhook
router.post('/remove', requireSignIn, async (req: Request, res: Response) => {
    const { webhookId, robotId } = req.body;
    const authenticatedReq = req as AuthenticatedRequest;

    try {
        if (!authenticatedReq.user) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }

        if (!webhookId || !robotId) {
            return res.status(400).json({ ok: false, error: 'Webhook ID and robot ID are required' });
        }

        const robot = await Robot.findOne({ 'recording_meta.id': robotId });

        if (!robot) {
            return res.status(404).json({ ok: false, error: 'Robot not found' });
        }

        const currentWebhooks = robot.webhooks || [];
        const webhookExists = currentWebhooks.find((w: WebhookConfig) => w.id === webhookId);

        if (!webhookExists) {
            return res.status(404).json({ ok: false, error: 'Webhook not found' });
        }

        const updatedWebhooks = currentWebhooks.filter((w: WebhookConfig) => w.id !== webhookId);
        
        robot.webhooks = updatedWebhooks;
        await robot.save();

        res.status(200).json({ 
            ok: true, 
            message: 'Webhook removed successfully'
        });
    } catch (error: any) {
        console.log(`Could not remove webhook - ${error}`);
        res.status(500).json({ ok: false, error: 'Could not remove webhook configuration' });
    }
});

// Get all webhooks for a robot
router.get('/list/:robotId', requireSignIn, async (req: Request, res: Response) => {
    const { robotId } = req.params;
    const authenticatedReq = req as AuthenticatedRequest;

    try {
        if (!authenticatedReq.user) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }

        const robot = await Robot.findOne({ 'recording_meta.id': robotId })
            .select('webhooks');

        if (!robot) {
            return res.status(404).json({ ok: false, error: 'Robot not found' });
        }

        const webhooks = robot.webhooks || [];

        res.status(200).json({ 
            ok: true, 
            webhooks: webhooks
        });
    } catch (error: any) {
        console.log(`Could not retrieve webhooks - ${error}`);
        res.status(500).json({ ok: false, error: 'Could not retrieve webhook configurations' });
    }
});

// Test webhook endpoint
router.post('/test', requireSignIn, async (req: Request, res: Response) => {
    const { webhook, robotId } = req.body;
    const authenticatedReq = req as AuthenticatedRequest;

    try {
        if (!authenticatedReq.user) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }

        if (!webhook || !robotId) {
            return res.status(400).json({ ok: false, error: 'Webhook configuration and robot ID are required' });
        }
        validateLegacyWebhookSettings(webhook);
        const deliverySettings = resolveStoredLegacyWebhookSettings(webhook);

        const robot = await Robot.findOne({ 'recording_meta.id': robotId });

        if (!robot) {
            return res.status(404).json({ ok: false, error: 'Robot not found' });
        }

        // Create test payload
        const testPayload = {
            event_type: "webhook_test",
            timestamp: new Date().toISOString(),
            webhook_id: webhook.id,
            data: {
                robot_id: robotId,
                run_id: "110c4dae-c39b-4b30-a932-eff1022e4bb0",
                robot_name: robot.recording_meta?.name || "E-commerce Product Scraper",
                status: "test",
                started_at: new Date(Date.now() - 45000).toISOString(),
                finished_at: new Date().toISOString(),
                extracted_data: {
                    captured_texts: [
                        {
                            "Product Name": "MacBook Pro 16-inch M3 Max",
                            "Price": "$3,999.00",
                            "Rating": "4.8/5 stars",
                            "Availability": "In Stock - Ships within 2-3 business days",
                            "SKU": "MBPM3-16-1TB-SLV",
                            "Description": "The most powerful MacBook Pro ever is here. With the blazing-fast M3 Max chip, pro-level performance has never been more portable."
                        }
                    ],
                    captured_lists: {
                        "list_1": [
                            {
                                "Rank": "1",
                                "Product": "MacBook Air M2",
                                "Category": "Laptops",
                                "Units Sold": "2,847",
                                "Revenue": "$2,847,000"
                            },
                            {
                                "Rank": "2", 
                                "Product": "iPhone 15",
                                "Category": "Smartphones",
                                "Units Sold": "1,923",
                                "Revenue": "$1,923,000"
                            },
                            {
                                "Rank": "3",
                                "Product": "iPad Pro 12.9",
                                "Category": "Tablets", 
                                "Units Sold": "1,456",
                                "Revenue": "$1,456,000"
                            }
                        ],
                        "list_0": [
                            {
                                "Customer": "Sarah M.",
                                "Rating": "5 stars",
                                "Review": "Absolutely love my new MacBook! The battery life is incredible and the performance is outstanding.",
                                "Date": "2024-12-15",
                                "Verified Purchase": "Yes"
                            },
                            {
                                "Customer": "John D.",
                                "Rating": "4 stars", 
                                "Review": "Great phone overall, but wish the battery lasted a bit longer with heavy usage.",
                                "Date": "2024-12-14",
                                "Verified Purchase": "Yes"
                            },
                            {
                                "Customer": "Emily R.",
                                "Rating": "5 stars",
                                "Review": "The camera quality is phenomenal! Perfect for my photography business.",
                                "Date": "2024-12-13",
                                "Verified Purchase": "Yes"
                            }
                        ],
                    },
                    total_rows: 11,
                    captured_texts_count: 5,
                    captured_lists_count: 6, 
                    screenshots_count: 5
                },
                metadata: {
                    test_mode: true,
                    browser_id: "d27ace57-75cb-441c-8589-8ba34e52f7d1", 
                    user_id: 108,
                }
            }
        };

        await updateWebhookLastCalled(robotId, webhook.id);

        const response = await postJsonWithRetry(webhook.url, testPayload, {
            attempts: 1,
            timeoutMs: deliverySettings.timeout * 1000,
            deadlineMs: deliverySettings.timeout * 1000,
        });

        const success = response.status >= 200 && response.status < 300;

        res.status(200).json({ 
            ok: true, 
            message: success ? 'Test webhook sent successfully' : 'Webhook endpoint responded with non-success status',
            details: {
                status: response.status,
                statusText: '',
                success: success
            }
        });
    } catch (error: any) {
        if (error instanceof RangeError) {
            return res.status(400).json({ ok: false, error: error.message });
        }
        console.log('Could not test webhook');
        
        try {
            await updateWebhookLastCalled(robotId, webhook.id);
        } catch (updateError) {
            console.error('Failed to update lastCalledAt after webhook error:', updateError);
        }
        
        let errorMessage = 'Could not send test webhook';
        if (error.code === 'ECONNREFUSED') {
            errorMessage = 'Connection refused - webhook URL is not accessible';
        } else if (error.code === 'ETIMEDOUT') {
            errorMessage = 'Request timeout - webhook endpoint did not respond in time';
        } else if (error.response) {
            errorMessage = `Webhook endpoint responded with error: ${error.response.status} ${error.response.statusText}`;
        }

        res.status(500).json({ 
            ok: false, 
            error: errorMessage,
            details: {
                code: error.code,
                message: errorMessage
            }
        });
    }
});

// Send webhook
export const sendWebhook = async (robotId: string, eventType: string, data: any): Promise<void> => {
    try {
        const robot = await Robot.findOne({ 'recording_meta.id': robotId });
        if (!robot || !robot.webhooks) {
            return;
        }

        const activeWebhooks = robot.webhooks.filter((w: WebhookConfig) => 
            w.active && w.events.includes(eventType)
        );

        if (activeWebhooks.length === 0) {
            return;
        }

        const webhookPromises = activeWebhooks.map(async (webhook: WebhookConfig) => {
            const payload = {
                event_type: eventType,
                timestamp: new Date().toISOString(),
                webhook_id: webhook.id,
                data: data
            };

            return sendWebhookWithRetry(robotId, webhook, payload);
        });

        await Promise.allSettled(webhookPromises);
    } catch (error) {
        console.error('Error sending webhooks:', error);
    }
};

// Helper function to send webhook with retry logic
const sendWebhookWithRetry = async (robotId: string, webhook: WebhookConfig, payload: any): Promise<void> => {
    const deliverySettings = resolveStoredLegacyWebhookSettings(webhook as unknown as Record<string, unknown>);

    try {
        await updateWebhookLastCalled(robotId, webhook.id);

        const response = await postJsonWithRetry(webhook.url, payload, {
            retryAttempts: deliverySettings.retryAttempts,
            delayMs: deliverySettings.retryDelay * 1000,
            timeoutMs: deliverySettings.timeout * 1000,
            deadlineMs: 120_000,
        });

        console.log(`Webhook sent successfully to ${safeOutboundUrlLogLabel(webhook.url)}: ${response.status}`);
    } catch (error: any) {
        console.error(
            `Webhook ${safeOutboundUrlLogLabel(webhook.url)} failed after ${deliverySettings.retryAttempts + 1} attempts:`,
            error.message
        );
    }
};

// Clear all webhooks for a robot
router.delete('/clear/:robotId', requireSignIn, async (req: Request, res: Response) => {
    const { robotId } = req.params;
    const authenticatedReq = req as AuthenticatedRequest;

    try {
        if (!authenticatedReq.user) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }

        const robot = await Robot.findOne({ 'recording_meta.id': robotId });

        if (!robot) {
            return res.status(404).json({ ok: false, error: 'Robot not found' });
        }

        robot.webhooks = [];
        await robot.save();

        res.status(200).json({ 
            ok: true, 
            message: 'All webhooks cleared successfully'
        });
    } catch (error: any) {
        console.log(`Could not clear webhooks - ${error}`);
        res.status(500).json({ ok: false, error: 'Could not clear webhook configurations' });
    }
});