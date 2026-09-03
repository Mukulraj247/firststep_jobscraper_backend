"""Generate category_rules_research.json from base rules + research expansions."""

from __future__ import annotations

import json
from pathlib import Path

# Import expanded base rules from v2 snapshot
from .classifier_v2 import CATEGORY_RULES as BASE_RULES

# Per-category expansions from research notes
EXPANSIONS: dict[str, dict] = {
    "Software Engineering": {
        "strong_title_terms": [
            "sde", "software development engineer", "principal engineer", "staff engineer",
            "staff software engineer", "senior software development engineer",
            "product engineer", "application engineer",
        ],
        "strong_terms": [
            "debugging", "object oriented programming", "oop", "version control",
            "software lifecycle", "write maintainable code",
        ],
        "technology_terms": ["github", "gitlab", "bitbucket"],
        "supporting_terms": ["pull request", "codebase", "refactoring"],
    },
    "Frontend Development": {
        "strong_title_terms": ["web engineer", "ui engineer", "frontend architect"],
        "strong_terms": ["component driven", "web performance", "core web vitals"],
        "technology_terms": ["svelte", "astro", "remix", "storybook"],
        "supporting_terms": ["semantic html", "aria", "lighthouse"],
    },
    "Backend Development": {
        "strong_title_terms": [
            "api engineer", "integration engineer", "services engineer",
            "server engineer", "microservices engineer",
        ],
        "strong_terms": [
            "server side api", "message queue", "event driven backend",
            "authentication service", "caching layer",
            "backend api", "backend apis", "node.js backend",
        ],
        "technology_terms": ["nestjs", "gin", "fiber", "laravel", "ruby on rails"],
        "combinations": [
            (["api", "engineer"], 4),
            (["graphql", "api"], 3),
            (["node.js", "backend"], 4),
            (["react", "backend"], 3),
        ],
    },
    "Full Stack Development": {
        "strong_title_terms": ["fullstack software engineer", "end to end engineer"],
        "strong_terms": ["mern stack", "mean stack", "t3 stack", "web application ownership"],
        "combinations": [(["mern", "stack"], 3), (["react", "node"], 4)],
        "evidence_gates": {
            "require_title_or_combo": True,
            "block_if_only_technology": ["react", "node.js", "mongodb"],
        },
    },
    "Mobile Application Development": {
        "strong_title_terms": ["swift developer", "kotlin developer", "mobile software engineer"],
        "technology_terms": ["swiftui", "android studio", "xcode", "expo"],
        "supporting_terms": ["app store submission", "mobile sdk integration"],
    },
    "DevOps": {
        "strong_title_terms": [
            "release engineer", "build engineer", "infrastructure engineer",
            "kubernetes engineer", "k8s engineer",
        ],
        "strong_terms": [
            "gitops", "deployment pipeline", "release automation",
            "container orchestration", "kubernetes administration",
        ],
        "technology_terms": ["pulumi", "spinnaker", "circleci", "bamboo", "kubeflow", "helm"],
        "combinations": [
            (["mlops", "kubernetes"], 4),
            (["kubernetes", "helm"], 3),
            (["kubernetes", "orchestration"], 3),
        ],
        "evidence_gates": {
            "require_any_strong": [
                "devops", "ci cd", "continuous integration", "continuous deployment",
                "infrastructure as code", "deployment automation", "release pipeline",
                "container orchestration", "kubernetes administration", "mlops",
                "gitops", "infrastructure engineering",
            ],
            "block_if_only_technology": ["kubernetes", "terraform", "docker", "jenkins"],
        },
    },
    "Site Reliability Engineering": {
        "strong_title_terms": ["observability engineer", "production engineer"],
        "strong_terms": ["sli", "error budget", "mttr", "mttd", "incident management"],
        "supporting_terms": ["chaos engineering", "reliability engineering"],
        "evidence_gates": {
            "require_any_strong": [
                "site reliability", "slo", "sla", "on call", "incident response",
                "observability", "error budget",
            ],
            "block_if_only_technology": ["kubernetes", "prometheus", "grafana"],
        },
    },
    "Cloud Engineering": {
        "strong_title_terms": [
            "cloud native engineer", "aws architect", "azure architect",
            "kubernetes engineer", "infrastructure engineer",
        ],
        "strong_terms": [
            "landing zone", "cloud governance", "serverless architecture",
            "infrastructure engineering", "cloud infrastructure",
        ],
        "technology_terms": ["iam", "cloudformation", "arm templates", "cloud run", "helm"],
        "combinations": [
            (["cloud", "infrastructure"], 3),
            (["infrastructure", "iac"], 3),
        ],
        "evidence_gates": {
            "require_any_strong": [
                "cloud infrastructure", "cloud migration", "cloud native",
                "cloud architecture", "cloud engineering", "infrastructure engineering",
            ],
            "block_if_only_technology": ["aws", "azure", "gcp", "lambda", "ec2"],
        },
    },
    "Platform Engineering": {
        "strong_title_terms": ["developer platform engineer", "devex engineer"],
        "strong_terms": [
            "paved road", "paved roads", "self service infrastructure",
            "internal developer portal", "developer experience",
        ],
        "technology_terms": ["crossplane", "humanitec", "port"],
        "evidence_gates": {
            "require_any_strong": [
                "platform engineering", "developer platform", "internal developer platform",
                "golden path", "self service platform", "devex",
            ],
            "block_if_only_technology": ["kubernetes", "terraform", "docker"],
        },
    },
    "Data Engineering": {
        "strong_title_terms": ["data lake engineer", "etl developer", "pipeline engineer"],
        "strong_terms": ["data lakehouse", "data orchestration", "streaming pipeline"],
        "technology_terms": ["iceberg", "delta lake", "prefect", "dagster"],
        "evidence_gates": {
            "require_any_strong_strict": [
                "data pipeline", "data pipelines", "pipeline", "pipelines", "etl", "elt",
                "data engineering", "data warehouse", "data lake", "data ingestion",
                "stream processing", "batch processing", "data orchestration",
                "airflow", "spark", "dbt", "kafka",
            ],
        },
    },
    "Data Analyst": {
        "strong_title_terms": [
            "product data analyst", "marketing analyst", "reporting specialist",
            "data governance analyst", "governance analyst",
        ],
        "strong_terms": [
            "kpi reporting", "ad hoc reporting", "business insights",
            "data governance", "data lineage", "master data management",
            "data quality management", "data stewardship",
        ],
        "technology_terms": ["mode", "metabase", "redash"],
    },
    "Data Science": {
        "strong_terms": ["causal inference", "forecasting", "experiment design"],
        "technology_terms": ["scikit learn", "xgboost", "lightgbm"],
        "evidence_gates": {
            "require_any_strong": [
                "data science", "statistical", "experimentation", "predictive modeling",
            ],
        },
    },
    "Machine Learning Engineer": {
        "strong_title_terms": [
            "computer vision engineer", "nlp engineer", "ml platform engineer",
        ],
        "strong_terms": ["model serving", "feature pipeline", "model monitoring"],
        "technology_terms": ["kubeflow", "sagemaker", "vertex ai"],
        "evidence_gates": {
            "require_any_strong": [
                "machine learning", "mlops", "model training", "model deployment",
                "model serving", "inference",
            ],
        },
    },
    "AI Engineer": {
        "strong_title_terms": [
            "ai safety researcher", "applied scientist", "genai engineer",
        ],
        "strong_terms": [
            "vector search", "function calling", "guardrails", "llm evaluation",
            "retrieval augmented generation", "ai agents",
        ],
        "technology_terms": ["pinecone", "weaviate", "chromadb", "anthropic"],
        "evidence_gates": {
            "require_any_strong": [
                "generative ai", "large language model", "llm", "rag",
                "artificial intelligence", "ai application",
            ],
        },
    },
    "Analytics Engineer": {
        "strong_terms": [
            "metrics layer", "data lineage", "transformation layer",
            "analytics code", "data tests",
        ],
        "combinations": [(["dbt", "semantic layer"], 4), (["dbt", "data modeling"], 3)],
    },
    "Business Intelligence": {
        "strong_title_terms": [
            "reporting developer", "bi specialist", "insights analyst",
        ],
        "strong_terms": ["executive reporting", "semantic model", "dax measures"],
        "technology_terms": ["dax", "lookml", "sisense"],
    },
    "Database Engineering": {
        "strong_terms": ["high availability", "failover", "database replication"],
        "technology_terms": ["mariadb", "cockroachdb", "cassandra"],
    },
    "QA / Testing": {
        "strong_terms": ["e2e testing", "api testing", "performance testing"],
        "technology_terms": ["k6", "gatling", "rest assured"],
    },
    "Cybersecurity": {
        "strong_title_terms": [
            "iam engineer", "security consultant", "application security engineer",
            "cloud security engineer", "threat hunter",
        ],
        "strong_terms": ["zero trust", "threat hunting", "vulnerability management"],
        "technology_terms": ["edr", "sentinel", "defender"],
        "evidence_gates": {
            "require_any_strong": [
                "cybersecurity", "information security", "security operations",
                "threat", "vulnerability", "incident response", "iam",
            ],
            "block_if_only_technology": ["security", "firewall"],
        },
    },
    "Network Engineering": {
        "strong_title_terms": ["noc engineer", "network operations engineer"],
        "strong_terms": ["sd wan", "network operations", "routing protocol"],
        "technology_terms": ["arista", "palo alto", "f5"],
    },
    "Product Management": {
        "strong_title_terms": ["growth product manager", "platform product manager"],
        "strong_terms": ["go to market strategy", "product discovery", "product launch"],
        "excluded_if_category": [],  # relaxed — allow co-list with SWE/Mobile
    },
    "Project Management": {
        "strong_title_terms": [
            "technical program manager", "tpm", "portfolio manager", "pmo manager",
        ],
        "strong_terms": ["raid log", "raci", "program delivery"],
        "combinations": [(["technical", "program manager"], 4), (["tpm", "delivery"], 3)],
    },
    "UI/UX Design": {
        "strong_title_terms": [
            "ux researcher", "service designer", "information architect",
            "visual designer", "interaction designer",
        ],
        "strong_terms": ["usability study", "design critique", "service design"],
        "supporting_terms": ["design sprint", "heuristic evaluation"],
    },
    "Technical Support": {
        "strong_title_terms": [
            "production support engineer", "application support analyst",
            "customer support engineer",
        ],
        "strong_terms": ["log analysis", "root cause analysis", "ticket escalation"],
        "technology_terms": ["jira service management", "freshdesk"],
    },
    "SAP": {
        "strong_terms": ["sap rap", "sap cap", "cds views", "odata services"],
        "technology_terms": ["ui5", "fiori", "hana database"],
        "combinations": [(["sap", "fiori"], 3), (["abap", "hana"], 3)],
    },
    "Salesforce": {
        "strong_terms": ["salesforce flow", "permission sets", "salesforce automation"],
        "technology_terms": ["lwc", "salesforce flow"],
        "combinations": [(["flow", "apex"], 3), (["lwc", "salesforce"], 3)],
        "evidence_gates": {
            "require_any_strong_strict": [
                "salesforce", "apex", "sfdc", "sales cloud", "service cloud",
                "lightning", "soql", "crm", "visualforce",
            ],
        },
    },
    "ERP": {
        "strong_title_terms": ["workday consultant", "netsuite developer"],
        "technology_terms": ["sap successfactors", "oracle fusion"],
    },
    "Blockchain / Web3": {
        "strong_terms": ["on chain", "protocol development", "smart contract audit"],
        "technology_terms": ["hardhat", "foundry", "anchor"],
    },
    "Embedded Systems": {
        "strong_title_terms": ["device driver engineer", "firmware developer"],
        "strong_terms": ["hardware software integration", "embedded linux development"],
        "technology_terms": ["freertos", "zephyr", "stm32"],
        "combinations": [(["firmware", "rtos"], 3)],
    },
    "Game Development": {
        "strong_title_terms": ["graphics programmer", "game engine developer"],
        "strong_terms": ["shader programming", "game physics", "multiplayer networking"],
        "technology_terms": ["godot", "directx", "vulkan"],
    },
    "System Administration": {
        "strong_title_terms": ["endpoint administrator", "server administrator"],
        "strong_terms": ["group policy", "active directory administration"],
        "technology_terms": ["intune", "sccm", "hyper v"],
    },
    "Solution Architecture": {
        "strong_title_terms": [
            "software architect", "enterprise architect", "solutions engineer",
            "integration architect",
        ],
        "strong_terms": [
            "reference architecture", "target architecture", "non functional requirements",
        ],
        "combinations": [(["solutions", "engineer"], 3)],
    },
    "Business Analysis": {
        "strong_title_terms": [
            "business systems analyst", "requirements analyst", "process analyst",
            "functional analyst", "data governance analyst", "governance analyst",
        ],
        "strong_terms": [
            "brd", "frd", "use case documentation", "process improvement",
            "data governance", "master data management", "data quality management",
            "data lineage", "data stewardship", "gap analysis",
        ],
    },
}

# Relax SWE exclusions per plan
SWE_RELAXED_EXCLUSIONS = ["SAP", "Salesforce", "ERP", "QA / Testing", "Embedded Systems"]

# Fix Product Management - remove SWE from its perspective (no exclusion needed)
# Fix Software Engineering exclusions - remove Frontend, Mobile, Product Management
RULE_OVERRIDES: dict[str, dict] = {
    "Software Engineering": {
        "excluded_if_category": SWE_RELAXED_EXCLUSIONS,
        "strong_title_terms": [],  # filled via EXPANSIONS
    },
    "Frontend Development": {"excluded_if_category": ["SAP", "Salesforce"]},
    "Backend Development": {"excluded_if_category": ["SAP", "Salesforce"]},
    "Product Management": {"excluded_if_category": []},
    "Platform Engineering": {"excluded_if_category": []},  # allow co-list with DevOps/SRE
    "Analytics Engineer": {"excluded_if_category": []},  # allow co-list with DE
    "Data Science": {"excluded_if_category": []},  # allow co-list with ML
}


def _merge_lists(base: list, extra: list) -> list:
    seen: set[tuple] = set()
    out = []
    for item in base + extra:
        # Normalize to hashable key for dedup
        if isinstance(item, (list, tuple)) and len(item) == 2 and isinstance(item[0], list):
            key = (tuple(item[0]), item[1])
            normalized = [list(item[0]), item[1]]
        else:
            key = (item,) if not isinstance(item, (list, tuple)) else tuple(item)
            normalized = list(item) if isinstance(item, tuple) else item
        if key not in seen:
            seen.add(key)
            out.append(normalized)
    return out


def _merge_combinations(base: list, extra: list) -> list:
    seen: set = set()
    out = []
    for item in base + extra:
        terms = tuple(item[0]) if isinstance(item[0], (list, tuple)) else (item[0],)
        bonus = item[1]
        key = (terms, bonus)
        if key not in seen:
            seen.add(key)
            out.append([list(terms), bonus])
    return out


def build_rules() -> dict:
    rules = {}
    for name, base in BASE_RULES.items():
        merged = dict(base)
        exp = EXPANSIONS.get(name, {})
        overrides = RULE_OVERRIDES.get(name, {})

        for key in ("strong_title_terms", "strong_terms", "technology_terms", "supporting_terms"):
            if key in exp:
                merged[key] = _merge_lists(merged.get(key, []), exp[key])
            if key in overrides:
                merged[key] = overrides[key] or merged.get(key, [])

        if "combinations" in exp:
            merged["combinations"] = _merge_combinations(merged.get("combinations", []), exp["combinations"])

        if "evidence_gates" in exp:
            merged["evidence_gates"] = exp["evidence_gates"]

        for key, val in overrides.items():
            if key not in ("strong_title_terms",):
                merged[key] = val

        rules[name] = merged
    return rules


def main():
    rules = build_rules()
    out = Path(__file__).parent / "category_rules_research.json"
    out.write_text(json.dumps(rules, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {out} ({len(rules)} categories)")


if __name__ == "__main__":
    main()
