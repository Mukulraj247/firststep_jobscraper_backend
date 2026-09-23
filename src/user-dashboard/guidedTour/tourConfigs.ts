import type { ScoutXTourConfig } from './types';

export const scoutXTourConfigs: ScoutXTourConfig[] = [
  {
    id: 'home-overview',
    label: 'Home overview',
    description: 'Metrics, date range, top companies/roles, activity, and the jobs chart',
    icon: 'home',
    route: '/user',
    steps: [
      {
        target: '[data-tour="scoutx-welcome"]',
        content:
          'Welcome to ScoutX. Your home shows plan status, active clusters, and a quick path into the feed.',
        skipBeacon: true,
        placement: 'bottom',
        title: 'Welcome',
      },
      {
        target: '[data-tour="scoutx-metrics"]',
        content:
          'These cards summarize active clusters, jobs in your feed, saved roles, and open requests.',
        skipBeacon: true,
        placement: 'bottom',
        title: 'Key metrics',
      },
      {
        target: '[data-tour="scoutx-date-range"]',
        content:
          'Pick a date range to filter Top companies, Top roles, and the jobs-over-time chart together.',
        skipBeacon: true,
        placement: 'bottom',
        title: 'Date range',
      },
      {
        target: '[data-tour="scoutx-insights"]',
        content: 'See which companies and roles show up most often in your selected window.',
        skipBeacon: true,
        placement: 'top',
        title: 'Feed insights',
      },
      {
        target: '[data-tour="scoutx-activity"]',
        content: 'Jump into your clusters or the latest jobs from this activity strip.',
        skipBeacon: true,
        placement: 'top',
        title: 'Your activity',
      },
      {
        target: '[data-tour="scoutx-jobs-chart"]',
        content:
          'Track jobs over time. Use the cluster chips above the chart to focus on one cluster or compare several.',
        skipBeacon: true,
        placement: 'top',
        title: 'Jobs over time',
      },
    ],
  },
  {
    id: 'browse-clusters',
    label: 'Browse clusters',
    description: 'Find and activate company clusters for your plan slots',
    icon: 'explore',
    route: '/user/clusters',
    steps: [
      {
        target: '[data-tour="scoutx-clusters-page"]',
        content:
          'Browse published clusters. Search and filter to find the company sets you want to monitor.',
        skipBeacon: true,
        placement: 'bottom',
        title: 'Cluster catalog',
      },
      {
        target: '[data-tour="scoutx-nav-clusters"]',
        content: 'You can always return here from Browse Clusters in the side navigation.',
        skipBeacon: true,
        placement: 'right',
        title: 'Navigation',
      },
    ],
  },
  {
    id: 'my-feed',
    label: 'My feed',
    description: 'Review, save, and assign fresh openings from your clusters',
    icon: 'feed',
    route: '/user/feed',
    steps: [
      {
        target: '[data-tour="scoutx-feed-page"]',
        content:
          'Your merged feed lists openings from every active cluster. Use filters to narrow by company, location, and more.',
        skipBeacon: true,
        placement: 'bottom',
        title: 'Your feed',
      },
      {
        target: '[data-tour="scoutx-nav-feed"]',
        content: 'Open My Feed anytime from the sidebar to catch new roles.',
        skipBeacon: true,
        placement: 'right',
        title: 'Navigation',
      },
    ],
  },
];
