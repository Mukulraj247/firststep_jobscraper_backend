"""Adversarial benchmark (100+ labeled jobs) for regression testing."""

from __future__ import annotations

# Edge cases from test_edge_cases.py (labeled into 33 categories)
EDGE_CASE_JOBS = [
    {"title": "Senior Software Development Engineer", "description": "Design and build scalable distributed systems. Java or Python. Microservices, cloud-native architecture, CI/CD.", "expected_categories": ["Software Engineering"]},
    {"title": "Principal Engineer", "description": "Principal-level technical leadership. Drive architectural vision across multiple teams. Deep expertise in distributed systems.", "expected_categories": ["Software Engineering"]},
    {"title": "Engineering Manager", "description": "Manage a team of 10+ engineers. Hiring, performance management, technical roadmap.", "expected_categories": []},
    {"title": "Staff Software Engineer", "description": "Staff SWE role. Technical leadership, cross-team projects, system design, mentoring.", "expected_categories": ["Software Engineering"]},
    {"title": "Software Architect", "description": "Design enterprise software architecture. Microservices, event-driven architecture, cloud platforms.", "expected_categories": ["Solution Architecture"]},
    {"title": "Technical Program Manager", "description": "TPM role. Cross-functional program management, technical project delivery, stakeholder coordination.", "expected_categories": ["Project Management"]},
    {"title": "Solutions Engineer", "description": "Solutions engineering. Technical pre-sales, customer demos, solution design, integration support.", "expected_categories": ["Solution Architecture"]},
    {"title": "Cloud Architect", "description": "Cloud architecture, multi-cloud strategy, migration planning, cloud governance.", "expected_categories": ["Cloud Engineering", "Solution Architecture"]},
    {"title": "Cloud Developer", "description": "Cloud application development using serverless functions, cloud-native services, AWS Lambda.", "expected_categories": ["Cloud Engineering"]},
    {"title": "IAM Engineer", "description": "Identity and access management. Okta, Azure AD, SSO, MFA, identity governance, provisioning.", "expected_categories": ["Cybersecurity"]},
    {"title": "Data Governance Analyst", "description": "Data governance, data quality management, master data management, data lineage.", "expected_categories": ["Data Analyst", "Business Analysis"]},
    {"title": "Data Lake Engineer", "description": "Data lake architecture, Delta Lake, Iceberg, data ingestion, metadata management.", "expected_categories": ["Data Engineering"]},
    {"title": "Computer Vision Researcher", "description": "Computer vision research, deep learning, image recognition, 3D vision, SLAM.", "expected_categories": ["Machine Learning Engineer"]},
    {"title": "AI Safety Researcher", "description": "AI safety, alignment, red teaming, evaluation of large language models.", "expected_categories": ["AI Engineer"]},
    {"title": "Cloud Native Engineer", "description": "Cloud-native development, containers, Kubernetes, microservices, service mesh.", "expected_categories": ["Cloud Engineering"]},
    {"title": "Kubernetes Engineer", "description": "Kubernetes administration, container orchestration, Helm, operators, cloud-native.", "expected_categories": ["DevOps", "Cloud Engineering"]},
    {"title": "Infrastructure Engineer", "description": "Infrastructure engineering, cloud infrastructure, IaC, networking, server management.", "expected_categories": ["DevOps", "Cloud Engineering"]},
    {"title": "Observability Engineer", "description": "Observability, distributed tracing, metrics, logging, APM, monitoring infrastructure.", "expected_categories": ["Site Reliability Engineering"]},
    {"title": "Security Consultant", "description": "Security consulting, risk assessment, compliance audits, security architecture design.", "expected_categories": ["Cybersecurity"]},
    {"title": "IT Consultant", "description": "IT consulting, technology solutions, system implementation, technical advisory.", "expected_categories": []},
    {"title": "NOC Engineer", "description": "Network operations center, NOC, monitoring, network troubleshooting, on-call support.", "expected_categories": ["Network Engineering"]},
    {"title": "Integration Engineer", "description": "Systems integration, API integration, middleware, enterprise application integration.", "expected_categories": ["Backend Development"]},
    {"title": "API Engineer", "description": "API design, REST API development, API gateway, API documentation, OpenAPI.", "expected_categories": ["Backend Development"]},
]

# Title-only variants (punctuation, seniority, abbreviations)
TITLE_VARIANT_JOBS = [
    {"title": "Sr. Backend Engineer", "description": "", "expected_categories": ["Backend Development"]},
    {"title": "Sr Backend Engineer", "description": "", "expected_categories": ["Backend Development"]},
    {"title": "S.W.E.", "description": "Write code, code reviews, software development.", "expected_categories": ["Software Engineering"]},
    {"title": "SDE II", "description": "Software development engineer building distributed systems.", "expected_categories": ["Software Engineering"]},
    {"title": "Front-End / UI Engineer", "description": "React, CSS, accessibility.", "expected_categories": ["Frontend Development"]},
    {"title": "Full-Stack Developer (Remote)", "description": "React and Node.js end to end.", "expected_categories": ["Full Stack Development"]},
    {"title": "DevOps / SRE", "description": "CI/CD, on-call, SLO management, Kubernetes.", "expected_categories": ["DevOps", "Site Reliability Engineering"]},
    {"title": "PM - Growth", "description": "Product roadmap, experimentation, go-to-market.", "expected_categories": ["Product Management"]},
    {"title": "BI Analyst (Contract)", "description": "Power BI dashboards and SQL reporting.", "expected_categories": ["Business Intelligence", "Data Analyst"]},
    {"title": "QA / SDET", "description": "Test automation with Playwright and Cypress.", "expected_categories": ["QA / Testing"]},
    {"title": "ML Eng.", "description": "Model training, deployment, MLOps pipelines.", "expected_categories": ["Machine Learning Engineer"]},
    {"title": "GenAI Engineer", "description": "LLM applications, RAG, vector search.", "expected_categories": ["AI Engineer"]},
    {"title": "Sr. SAP ABAP Developer", "description": "SAP ABAP, Fiori, S/4HANA.", "expected_categories": ["SAP"]},
    {"title": "Salesforce Admin / Developer", "description": "Apex, Flow, LWC, CRM configuration.", "expected_categories": ["Salesforce"]},
    {"title": "UX Researcher II", "description": "User interviews, usability studies, journey mapping.", "expected_categories": ["UI/UX Design"]},
]

# Noisy descriptions (filler, unrelated tech)
NOISY_DESCRIPTION_JOBS = [
    {"title": "Product Manager", "description": "Lead product strategy. We use Python internally but this is not a coding role. Focus on roadmap and discovery.", "expected_categories": ["Product Management"]},
    {"title": "Data Analyst", "description": "Excel, SQL, Tableau. Our office has a coffee machine and great benefits. Build KPI dashboards.", "expected_categories": ["Data Analyst"]},
    {"title": "SAP Consultant", "description": "SAP implementation. Team lunch on Fridays. ABAP and Fiori development for finance modules.", "expected_categories": ["SAP"]},
    {"title": "Network Engineer", "description": "Cisco routing and switching. We also mention AWS but networking is the core responsibility.", "expected_categories": ["Network Engineering"]},
    {"title": "Business Analyst", "description": "Requirements gathering and process mapping. Jira experience helpful. Not a software developer role.", "expected_categories": ["Business Analysis"]},
    {"title": "Technical Support Specialist", "description": "Troubleshoot tickets in ServiceNow. Zendesk experience. Customer-facing issue resolution.", "expected_categories": ["Technical Support"]},
    {"title": "Embedded Firmware Engineer", "description": "C/C++ on ARM microcontrollers. RTOS, UART/SPI. Hardware-software integration.", "expected_categories": ["Embedded Systems"]},
    {"title": "Game Developer", "description": "Unity and C# gameplay programming. Shaders and physics. Unrelated: we use Slack.", "expected_categories": ["Game Development"]},
    {"title": "Analytics Engineer", "description": "dbt models, semantic layer, data tests, lineage documentation.", "expected_categories": ["Analytics Engineer"]},
    {"title": "Platform Engineer", "description": "Internal developer platform, golden paths, Backstage, self-service infrastructure.", "expected_categories": ["Platform Engineering"]},
    {"title": "Database Administrator", "description": "Oracle DBA, backup recovery, performance tuning, replication.", "expected_categories": ["Database Engineering"]},
    {"title": "ERP Consultant", "description": "NetSuite implementation and finance module configuration.", "expected_categories": ["ERP"]},
    {"title": "Blockchain Developer", "description": "Solidity smart contracts on Ethereum. DeFi protocol development.", "expected_categories": ["Blockchain / Web3"]},
    {"title": "SysAdmin", "description": "Windows/Linux server administration, AD, patching, VMware.", "expected_categories": ["System Administration"]},
    {"title": "Project Manager", "description": "Agile delivery, RAID log, stakeholder management, budget tracking.", "expected_categories": ["Project Management"]},
]

# Hybrid multi-label
HYBRID_MULTI_LABEL_JOBS = [
    {"title": "Product Manager - Mobile", "description": "Own mobile app roadmap. iOS and Android releases, app store strategy.", "expected_categories": ["Product Management", "Mobile Application Development"]},
    {"title": "Full Stack Engineer", "description": "React frontend and Node.js backend APIs. End-to-end web application ownership.", "expected_categories": ["Full Stack Development", "Frontend Development", "Backend Development"]},
    {"title": "Cloud DevOps Engineer", "description": "AWS infrastructure, Terraform IaC, CI/CD pipelines, Kubernetes deployments.", "expected_categories": ["DevOps", "Cloud Engineering"]},
    {"title": "Analytics Engineer", "description": "dbt transformations on Snowflake data warehouse. Partner with data engineering on pipelines.", "expected_categories": ["Analytics Engineer", "Data Engineering"]},
    {"title": "BI Data Analyst", "description": "Power BI executive dashboards and SQL ad hoc analysis for finance.", "expected_categories": ["Business Intelligence", "Data Analyst"]},
    {"title": "ML Platform Engineer", "description": "MLOps, model serving on Kubernetes, feature stores, Kubeflow pipelines.", "expected_categories": ["Machine Learning Engineer", "DevOps"]},
    {"title": "Security Network Engineer", "description": "Firewall management, VPN, threat detection, Cisco ASA, SIEM monitoring.", "expected_categories": ["Network Engineering", "Cybersecurity"]},
    {"title": "Solution Architect - Cloud", "description": "Enterprise cloud architecture on Azure. Migration strategy and reference architectures.", "expected_categories": ["Solution Architecture", "Cloud Engineering"]},
    {"title": "Frontend Engineer", "description": "React, TypeScript, design system components, accessibility.", "expected_categories": ["Frontend Development"]},
    {"title": "Backend API Engineer", "description": "Java Spring Boot microservices, GraphQL, PostgreSQL, Kafka.", "expected_categories": ["Backend Development"]},
    {"title": "Mobile iOS Engineer", "description": "Swift, SwiftUI, App Store releases, mobile performance.", "expected_categories": ["Mobile Application Development"]},
    {"title": "SRE / Platform", "description": "SLOs, on-call, internal developer platform tooling, Kubernetes.", "expected_categories": ["Site Reliability Engineering", "Platform Engineering"]},
    {"title": "Data Engineer / Analyst", "description": "Build pipelines with Airflow and also create Tableau dashboards for stakeholders.", "expected_categories": ["Data Engineering", "Data Analyst"]},
    {"title": "Salesforce Developer", "description": "Apex, LWC, integration with external APIs using Python middleware.", "expected_categories": ["Salesforce"]},
    {"title": "SAP + Java Developer", "description": "SAP ABAP and Java integration for S/4HANA extensions.", "expected_categories": ["SAP"]},
    {"title": "Technical Product Manager", "description": "API product roadmap, developer experience, technical PRDs for platform team.", "expected_categories": ["Product Management"]},
    {"title": "UX/UI Designer", "description": "Figma prototypes, user research, interaction design for web app.", "expected_categories": ["UI/UX Design"]},
    {"title": "QA Automation Engineer", "description": "Selenium, API testing, CI integration for regression suites.", "expected_categories": ["QA / Testing"]},
    {"title": "Data Scientist", "description": "Experimentation, causal inference, forecasting with Python and scikit-learn.", "expected_categories": ["Data Science"]},
    {"title": "AI Application Engineer", "description": "Build LLM agents with RAG, embeddings, evaluation and guardrails.", "expected_categories": ["AI Engineer"]},
]

# Domain-specialized (SAP+Java, Salesforce+Python, etc.)
DOMAIN_SPECIALIZED_JOBS = [
    {"title": "SAP ABAP Developer", "description": "ABAP, OData, CDS views, S/4HANA RAP development.", "expected_categories": ["SAP"]},
    {"title": "SAP Fiori Consultant", "description": "UI5/Fiori apps, SAP BTP, integration with backend services.", "expected_categories": ["SAP"]},
    {"title": "Salesforce Apex Developer", "description": "Apex, SOQL, Lightning Web Components, Sales Cloud.", "expected_categories": ["Salesforce"]},
    {"title": "Workday ERP Consultant", "description": "Workday HCM implementation, configuration, integration.", "expected_categories": ["ERP"]},
    {"title": "Dynamics 365 Developer", "description": "Microsoft Dynamics ERP customization and finance modules.", "expected_categories": ["ERP"]},
    {"title": "Oracle ERP Analyst", "description": "Oracle ERP finance and procurement module configuration.", "expected_categories": ["ERP"]},
    {"title": "Solidity Smart Contract Engineer", "description": "Ethereum EVM, DeFi protocols, on-chain development.", "expected_categories": ["Blockchain / Web3"]},
    {"title": "Firmware Engineer", "description": "Embedded C, device drivers, bare metal ARM, RTOS.", "expected_categories": ["Embedded Systems"]},
    {"title": "Unreal Engine Programmer", "description": "C++ gameplay systems, shaders, multiplayer networking.", "expected_categories": ["Game Development"]},
    {"title": "Linux Sysadmin", "description": "Linux server admin, bash scripting, backups, patching.", "expected_categories": ["System Administration"]},
    {"title": "Enterprise Architect", "description": "TOGAF, reference architecture, NFRs, architecture review board.", "expected_categories": ["Solution Architecture"]},
    {"title": "DAX Developer", "description": "Power BI semantic models, DAX measures, executive reporting.", "expected_categories": ["Business Intelligence"]},
    {"title": "PostgreSQL DBA", "description": "Database performance tuning, replication, backup recovery.", "expected_categories": ["Database Engineering"]},
    {"title": "ServiceNow Support Engineer", "description": "Application support, incident troubleshooting, log analysis, APIs.", "expected_categories": ["Technical Support"]},
    {"title": "Functional Business Analyst", "description": "BRD, FRD, user stories, process mapping, gap analysis.", "expected_categories": ["Business Analysis"]},
]

# Negative / zero-tag (non-tech roles)
NEGATIVE_JOBS = [
    {"title": "Security Guard", "description": "Patrol premises, monitor CCTV, report incidents.", "expected_categories": []},
    {"title": "Registered Nurse", "description": "Patient care, medication administration, clinical documentation.", "expected_categories": []},
    {"title": "Auto Detailer", "description": "Wash and detail vehicles, interior cleaning.", "expected_categories": []},
    {"title": "Retail Store Manager", "description": "Manage store staff, inventory, customer service.", "expected_categories": []},
    {"title": "Marketing Coordinator", "description": "Social media campaigns, email marketing, event planning.", "expected_categories": []},
    {"title": "HR Generalist", "description": "Recruiting, onboarding, employee relations.", "expected_categories": []},
    {"title": "Accountant", "description": "General ledger, accounts payable, month-end close.", "expected_categories": []},
    {"title": "Warehouse Associate", "description": "Pick and pack orders, forklift operation.", "expected_categories": []},
    {"title": "Chef", "description": "Menu planning, food preparation, kitchen management.", "expected_categories": []},
    {"title": "Real Estate Agent", "description": "Property sales, client showings, contract negotiation.", "expected_categories": []},
    {"title": "Dental Hygienist", "description": "Patient cleanings, X-rays, oral health education.", "expected_categories": []},
    {"title": "Truck Driver", "description": "CDL, long haul routes, DOT compliance.", "expected_categories": []},
    {"title": "Paralegal", "description": "Legal research, document preparation, case files.", "expected_categories": []},
    {"title": "Fitness Instructor", "description": "Lead group classes, personal training sessions.", "expected_categories": []},
    {"title": "Landscaper", "description": "Lawn maintenance, irrigation, seasonal planting.", "expected_categories": []},
]

# Title/description conflict
CONFLICT_JOBS = [
    {"title": "Data Analyst", "description": "This role is actually a backend engineer building Java microservices and REST APIs.", "expected_categories": ["Backend Development"]},
    {"title": "Software Engineer", "description": "Primarily Salesforce administration, Flow automation, and user permissions.", "expected_categories": ["Salesforce"]},
    {"title": "Business Analyst", "description": "DevOps engineer maintaining CI/CD, Docker, Kubernetes, Terraform.", "expected_categories": ["DevOps"]},
    {"title": "Project Coordinator", "description": "Senior product manager owning roadmap, discovery, and GTM launch.", "expected_categories": ["Product Management"]},
    {"title": "IT Support", "description": "Machine learning model training and deployment with PyTorch.", "expected_categories": ["Machine Learning Engineer"]},
    {"title": "Network Technician", "description": "Frontend React developer building design system components.", "expected_categories": ["Frontend Development"]},
    {"title": "Consultant", "description": "SAP ABAP development for S/4HANA finance modules.", "expected_categories": ["SAP"]},
    {"title": "Engineer", "description": "Civil structural engineering, AutoCAD, building codes.", "expected_categories": []},
    {"title": "Analyst", "description": "Cybersecurity SOC analyst, SIEM, threat hunting, incident response.", "expected_categories": ["Cybersecurity"]},
    {"title": "Developer", "description": "Mobile Flutter developer for cross-platform iOS and Android apps.", "expected_categories": ["Mobile Application Development"]},
]

BENCHMARK_ADVERSARIAL: list[dict] = (
    EDGE_CASE_JOBS
    + TITLE_VARIANT_JOBS
    + NOISY_DESCRIPTION_JOBS
    + HYBRID_MULTI_LABEL_JOBS
    + DOMAIN_SPECIALIZED_JOBS
    + NEGATIVE_JOBS
    + CONFLICT_JOBS
)

BENCHMARK_CORE = None  # populated from job_category_test_data at import

def get_all_benchmark_jobs() -> list[dict]:
    try:
        from .test_data import TEST_JOBS
    except ImportError:
        from classifier.test_data import TEST_JOBS
    return list(TEST_JOBS) + list(BENCHMARK_ADVERSARIAL)
