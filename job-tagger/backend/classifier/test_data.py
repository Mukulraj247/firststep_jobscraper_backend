"""Test dataset for deterministic job category tagging (80 labeled examples)."""

TEST_JOBS = [
    {
        "title": "Senior Product Manager",
        "description": "Looking for a product manager to lead development of a mobile application. Experience with Android, iOS, APIs, software development lifecycle, and Agile methodologies required.",
        "expected_categories": ["Product Management", "Mobile Application Development"],
    },
    {
        "title": "Data Analyst",
        "description": "Responsible for migrating reports from Power BI to Tableau, creating dashboards, analyzing business data, and writing SQL queries.",
        "expected_categories": ["Data Analyst", "Business Intelligence"],
    },
    {
        "title": "Senior Data Engineer",
        "description": "Build and maintain data pipelines using Python, SQL, Spark, Databricks, and Airflow. Experience with ETL and data warehouse design required.",
        "expected_categories": ["Data Engineering"],
    },
    {
        "title": "SAP Developer",
        "description": "SAP development using Java and Spring. Implement SAP Fiori applications and ABAP enhancements for S/4HANA modules.",
        "expected_categories": ["SAP"],
    },
    {
        "title": "Java Developer",
        "description": "Develop enterprise Java applications using Spring Boot, REST APIs, and microservices. Participate in code reviews and agile ceremonies.",
        "expected_categories": ["Software Engineering", "Backend Development"],
    },
    {
        "title": "Python Developer",
        "description": "Build backend services with Python, Django, and PostgreSQL. Design REST APIs and deploy to AWS.",
        "expected_categories": ["Software Engineering", "Backend Development", "Cloud Engineering"],
    },
    {
        "title": "Senior Full Stack Engineer",
        "description": "React, Node.js, TypeScript, MongoDB, AWS, REST APIs. End-to-end web application development.",
        "expected_categories": ["Full Stack Development", "Frontend Development", "Backend Development"],
    },
    {
        "title": "Machine Learning Engineer",
        "description": "Train and deploy ML models using Python, TensorFlow, PyTorch, and MLflow. Build ML pipelines on AWS SageMaker.",
        "expected_categories": ["Machine Learning Engineer"],
    },
    {
        "title": "Data Scientist",
        "description": "Apply statistical modeling, hypothesis testing, and predictive modeling using Python, pandas, and Jupyter notebooks.",
        "expected_categories": ["Data Science"],
    },
    {
        "title": "DevOps Engineer",
        "description": "Manage CI/CD pipelines with Jenkins and GitHub Actions. Docker, Kubernetes, Terraform, and AWS infrastructure automation.",
        "expected_categories": ["DevOps", "Cloud Engineering"],
    },
    {
        "title": "Frontend Developer",
        "description": "Build responsive web UIs with React, TypeScript, HTML, CSS, and Tailwind. Collaborate with UX team on component libraries.",
        "expected_categories": ["Frontend Development"],
    },
    {
        "title": "Backend Engineer",
        "description": "Design scalable backend services with Node.js, Express, GraphQL, and Redis. Microservices on Kubernetes.",
        "expected_categories": ["Backend Development"],
    },
    {
        "title": "Android Developer",
        "description": "Native Android development with Kotlin and Jetpack Compose. Publish apps to Google Play.",
        "expected_categories": ["Mobile Application Development"],
    },
    {
        "title": "iOS Developer",
        "description": "Build iOS applications using Swift and UIKit. Experience with App Store submission and mobile performance optimization.",
        "expected_categories": ["Mobile Application Development"],
    },
    {
        "title": "QA Engineer",
        "description": "Design test plans and automate regression testing with Selenium, Cypress, and pytest. Track defects in Jira.",
        "expected_categories": ["QA / Testing"],
    },
    {
        "title": "Cybersecurity Engineer",
        "description": "Monitor security events in SIEM, perform vulnerability assessments, and respond to incidents. OWASP and firewall experience.",
        "expected_categories": ["Cybersecurity"],
    },
    {
        "title": "Business Intelligence Analyst",
        "description": "Develop enterprise BI dashboards in Power BI and Qlik. SQL queries against data warehouse for executive reporting.",
        "expected_categories": ["Business Intelligence", "Data Analyst"],
    },
    {
        "title": "Salesforce Developer",
        "description": "Apex, Lightning Web Components, and Salesforce CRM customization. SOQL queries and integration with external APIs.",
        "expected_categories": ["Salesforce"],
    },
    {
        "title": "Cloud Engineer",
        "description": "Design and deploy cloud native solutions on AWS using EC2, Lambda, ECS, and CloudFormation.",
        "expected_categories": ["Cloud Engineering"],
    },
    {
        "title": "Technical Product Manager",
        "description": "Own product roadmap for API platform. Write PRDs, prioritize backlog, work with engineering on technical product requirements.",
        "expected_categories": ["Product Management"],
    },
    {
        "title": "Network Engineer",
        "description": "Configure Cisco routers and switches, BGP, OSPF, VPN, and network troubleshooting for enterprise WAN/LAN.",
        "expected_categories": ["Network Engineering"],
    },
    {
        "title": "AI Engineer",
        "description": "Build generative AI applications with LLMs, LangChain, RAG pipelines, and prompt engineering for enterprise chatbots.",
        "expected_categories": ["AI Engineer"],
    },
    {
        "title": "Analytics Engineer",
        "description": "Build dbt models and analytics pipelines on Snowflake. Define semantic layer and data transformations for BI team.",
        "expected_categories": ["Analytics Engineer", "Data Engineering"],
    },
    {
        "title": "Database Administrator",
        "description": "Oracle DBA responsible for database performance tuning, backup and recovery, replication, and query optimization.",
        "expected_categories": ["Database Engineering"],
    },
    {
        "title": "Site Reliability Engineer",
        "description": "Maintain SLOs, on-call rotation, incident response, and observability with Prometheus, Grafana, and Kubernetes.",
        "expected_categories": ["Site Reliability Engineering", "DevOps"],
    },
    {
        "title": "UX Designer",
        "description": "Create wireframes, prototypes, and conduct usability testing. Proficient in Figma and design systems.",
        "expected_categories": ["UI/UX Design"],
    },
    {
        "title": "Project Manager",
        "description": "Manage project timelines, budgets, and stakeholder communication. PMP certified. MS Project and Jira experience.",
        "expected_categories": ["Project Management"],
    },
    {
        "title": "Blockchain Developer",
        "description": "Develop smart contracts in Solidity on Ethereum. Web3.js integration for decentralized applications.",
        "expected_categories": ["Blockchain / Web3"],
    },
    {
        "title": "Embedded Software Engineer",
        "description": "Firmware development for microcontrollers using C, RTOS, and ARM. Device drivers and bare metal programming.",
        "expected_categories": ["Embedded Systems"],
    },
    {
        "title": "Unity Game Developer",
        "description": "Gameplay programming in Unity with C#. 3D game development and physics engine tuning.",
        "expected_categories": ["Game Development"],
    },
    {
        "title": "System Administrator",
        "description": "Windows and Linux server administration, Active Directory, patch management, and VMware virtualization.",
        "expected_categories": ["System Administration"],
    },
    {
        "title": "Solution Architect",
        "description": "Design enterprise solution architecture for microservices integration on Azure. Technical architecture reviews and standards.",
        "expected_categories": ["Solution Architecture", "Cloud Engineering"],
    },
    {
        "title": "Business Analyst",
        "description": "Gather business requirements, process mapping, gap analysis, and write functional specifications for IT projects.",
        "expected_categories": ["Business Analysis"],
    },
    {
        "title": "Technical Support Engineer",
        "description": "Provide L2 technical support via ServiceNow. Troubleshoot VPN, Office 365, and Active Directory issues.",
        "expected_categories": ["Technical Support"],
    },
    {
        "title": "ERP Consultant",
        "description": "Lead ERP implementation for finance and supply chain modules. Oracle ERP and NetSuite experience.",
        "expected_categories": ["ERP"],
    },
    {
        "title": "Platform Engineer",
        "description": "Build internal developer platform on Kubernetes with Terraform, Backstage, and golden path tooling.",
        "expected_categories": ["Platform Engineering"],
    },
    {
        "title": "React Native Developer",
        "description": "Cross-platform mobile app development with React Native, TypeScript, and push notifications.",
        "expected_categories": ["Mobile Application Development", "Frontend Development"],
    },
    {
        "title": "Penetration Tester",
        "description": "Conduct penetration testing and vulnerability assessments. Burp Suite, Nmap, and OWASP methodology.",
        "expected_categories": ["Cybersecurity"],
    },
    {
        "title": "SAP FICO Consultant",
        "description": "SAP S/4HANA FICO module configuration, SAP ERP implementation, and finance process mapping.",
        "expected_categories": ["SAP"],
    },
    {
        "title": "SDET",
        "description": "Software Development Engineer in Test. Build test automation frameworks with Playwright and TestNG.",
        "expected_categories": ["QA / Testing"],
    },
    {
        "title": "Lead Data Scientist",
        "description": "Lead data science team. A/B testing, feature engineering, predictive modeling with Python and scikit-learn.",
        "expected_categories": ["Data Science"],
    },
    {
        "title": "Software Engineer",
        "description": "General software development across the stack. Java, Python, Git, code review, and agile development.",
        "expected_categories": ["Software Engineering"],
    },
    {
        "title": "Scrum Master",
        "description": "Facilitate agile ceremonies, remove impediments, and coach teams on Scrum practices. Jira administration.",
        "expected_categories": ["Project Management"],
    },
    {
        "title": "Web Developer",
        "description": "Frontend web development with Vue.js, JavaScript, HTML, CSS, and responsive design.",
        "expected_categories": ["Frontend Development"],
    },
    {
        "title": "SQL Developer",
        "description": "Write complex SQL queries, stored procedures, and optimize database performance on SQL Server.",
        "expected_categories": ["Database Engineering"],
    },
    {
        "title": "Marketing Coordinator",
        "description": "Coordinate social media campaigns, email marketing, and content calendar. No technical requirements.",
        "expected_categories": [],
    },
    {
        "title": "Office Manager",
        "description": "Manage office operations, scheduling, and vendor relationships. Administrative support role.",
        "expected_categories": [],
    },
    {
        "title": "Intern",
        "description": "General internship. Will learn about the company. Flexible role.",
        "expected_categories": [],
    },
    {
        "title": "Java mentioned only",
        "description": "We use Java internally but this is a SAP ABAP role focused on SAP ERP module configuration.",
        "expected_categories": ["SAP"],
    },
    {
        "title": "Python mentioned only",
        "description": "Our team uses Python scripts occasionally. Primary role is Salesforce Administrator managing CRM workflows.",
        "expected_categories": ["Salesforce"],
    },
    {
        "title": "Software Engineer - Infrastructure",
        "description": "Write automation scripts, manage Docker and Kubernetes clusters, CI/CD with GitHub Actions.",
        "expected_categories": ["DevOps", "Software Engineering"],
    },
    {
        "title": "Product Owner",
        "description": "Own product backlog, write user stories, prioritize features, and define product vision for SaaS platform.",
        "expected_categories": ["Product Management"],
    },
    {
        "title": "Data Engineer / Analyst Hybrid",
        "description": "Build ETL pipelines with Airflow and also create Tableau dashboards for business stakeholders.",
        "expected_categories": ["Data Engineering", "Data Analyst", "Business Intelligence"],
    },
    {
        "title": "MLOps Engineer",
        "description": "Deploy and monitor machine learning models in production. MLflow, Kubernetes, model serving, and CI/CD for ML pipelines.",
        "expected_categories": ["Machine Learning Engineer", "DevOps"],
    },
    {
        "title": "Security Analyst",
        "description": "SOC analyst monitoring SIEM alerts, threat detection, and security incident response.",
        "expected_categories": ["Cybersecurity"],
    },
    {
        "title": "Golang Backend Developer",
        "description": "Build high-performance backend microservices in Go with gRPC, PostgreSQL, and Redis.",
        "expected_categories": ["Backend Development"],
    },
    {
        "title": "Angular Frontend Engineer",
        "description": "Develop enterprise SPA with Angular, TypeScript, RxJS, and component libraries.",
        "expected_categories": ["Frontend Development"],
    },
    {
        "title": "Azure Cloud Architect",
        "description": "Design cloud architecture on Microsoft Azure. Cloud migration, Azure DevOps, and hybrid cloud solutions.",
        "expected_categories": ["Cloud Engineering", "Solution Architecture"],
    },
    {
        "title": "Tableau Developer",
        "description": "Create interactive dashboards and reporting solutions in Tableau. SQL data extraction and KPI tracking.",
        "expected_categories": ["Business Intelligence", "Data Analyst"],
    },
    {
        "title": "Power BI Developer",
        "description": "Develop Power BI dashboards, DAX measures, and enterprise reporting from SQL Server data warehouse.",
        "expected_categories": ["Business Intelligence", "Data Analyst"],
    },
    {
        "title": "Firmware Engineer",
        "description": "Embedded firmware for IoT devices. C programming, RTOS, UART, SPI, and hardware bring-up.",
        "expected_categories": ["Embedded Systems"],
    },
    {
        "title": "Unreal Engine Developer",
        "description": "Game development with Unreal Engine and C++. Level design and multiplayer networking.",
        "expected_categories": ["Game Development"],
    },
    {
        "title": "Help Desk Technician",
        "description": "Tier 1 help desk support. Ticket resolution, desktop support, Windows troubleshooting.",
        "expected_categories": ["Technical Support"],
    },
    {
        "title": "IT Project Manager",
        "description": "Manage IT project delivery, timelines, budgets, and cross-functional teams. PMP and Jira.",
        "expected_categories": ["Project Management"],
    },
    {
        "title": "LLM Engineer",
        "description": "Build applications with large language models, RAG, vector databases, and Hugging Face transformers.",
        "expected_categories": ["AI Engineer"],
    },
    {
        "title": "Databricks Data Engineer",
        "description": "Spark jobs on Databricks, Delta Lake, ETL pipelines, and data lake architecture.",
        "expected_categories": ["Data Engineering"],
    },
    {
        "title": "C++ Software Engineer",
        "description": "Low-level C++ application development, performance optimization, and multithreading.",
        "expected_categories": ["Software Engineering"],
    },
    {
        "title": "Service Desk Analyst",
        "description": "Service desk analyst handling end user support tickets in ServiceNow and Zendesk.",
        "expected_categories": ["Technical Support"],
    },
    {
        "title": "Oracle ERP Consultant",
        "description": "Oracle ERP implementation for finance modules. ERP configuration and integration.",
        "expected_categories": ["ERP"],
    },
    {
        "title": "Web3 Solidity Developer",
        "description": "Smart contract development on Polygon. DeFi protocols and Web3 integration.",
        "expected_categories": ["Blockchain / Web3"],
    },
    {
        "title": "Product Designer",
        "description": "Product design including user research, wireframes, prototypes in Figma, and usability testing.",
        "expected_categories": ["UI/UX Design"],
    },
    {
        "title": "Reporting Analyst",
        "description": "Ad hoc data analysis, Excel reporting, SQL queries, and monthly KPI dashboards.",
        "expected_categories": ["Data Analyst"],
    },
    {
        "title": "Kafka Streaming Engineer",
        "description": "Real-time stream processing with Apache Kafka and Spark Streaming. Event-driven data pipelines.",
        "expected_categories": ["Data Engineering"],
    },
    {
        "title": "Linux System Administrator",
        "description": "Linux systems administration, bash scripting, server maintenance, and monitoring.",
        "expected_categories": ["System Administration"],
    },
    {
        "title": "Technical Architect",
        "description": "Define technical architecture standards, review system designs, and guide engineering teams on microservices.",
        "expected_categories": ["Solution Architecture"],
    },
    {
        "title": "CRM Administrator",
        "description": "Salesforce CRM administration, workflow rules, process builder, and user training.",
        "expected_categories": ["Salesforce"],
    },
    {
        "title": "ETL Developer",
        "description": "Design ETL processes, data integration, SQL, and Informatica workflows for data warehouse loading.",
        "expected_categories": ["Data Engineering"],
    },
    {
        "title": "Computer Vision Engineer",
        "description": "Deep learning for computer vision. PyTorch, neural networks, model training and deployment.",
        "expected_categories": ["Machine Learning Engineer"],
    },
    {
        "title": "Associate Product Manager",
        "description": "Support product roadmap, market research, and product discovery for mobile app product line.",
        "expected_categories": ["Product Management"],
    },
    {
        "title": "Fullstack JavaScript Developer",
        "description": "MERN stack development. MongoDB, Express, React, Node.js for full stack web apps.",
        "expected_categories": ["Full Stack Development", "Frontend Development", "Backend Development"],
    },
]

# Demo jobs for Section 11 — descriptions that trigger many rule tags (>3)
OVER_TAGGING_DEMO_JOBS = [
    {
        "title": "Senior Full Stack Cloud DevOps Engineer",
        "description": (
            "Build full stack web applications with React, Node.js, TypeScript, and MongoDB. "
            "Deploy on AWS with Docker, Kubernetes, Jenkins, and Terraform. "
            "CI/CD pipelines, microservices, and REST APIs. Agile team."
        ),
        "primary_categories": ["DevOps", "Full Stack Development", "Cloud Engineering"],
    },
    {
        "title": "Technical Lead",
        "description": (
            "Lead team building Python and Java services with React frontend on AWS and Azure. "
            "Docker, Kubernetes, SQL, Spark, machine learning models, agile scrum, "
            "product roadmap, microservices architecture."
        ),
        "primary_categories": ["Solution Architecture", "DevOps", "Full Stack Development"],
    },
    {
        "title": "Data Platform Full Stack Engineer",
        "description": (
            "Full stack development with React and Node.js. Build data pipelines with "
            "Python, SQL, Spark, and Airflow. Power BI dashboards, AWS cloud deployment, "
            "Docker, Kubernetes, ETL, and REST APIs."
        ),
        "primary_categories": ["Data Engineering", "Full Stack Development", "DevOps"],
    },
    {
        "title": "Cloud DevOps Backend Engineer",
        "description": (
            "Backend microservices in Java Spring Boot and Python Django. "
            "AWS and Azure cloud infrastructure, Docker, Kubernetes, Terraform, "
            "CI/CD with Jenkins, PostgreSQL, Redis, GraphQL, and API development."
        ),
        "primary_categories": ["DevOps", "Backend Development", "Cloud Engineering"],
    },
    {
        "title": "Mobile Full Stack Product Engineer",
        "description": (
            "React Native mobile apps and React web frontend. Node.js backend, MongoDB, "
            "AWS deployment, product roadmap, agile user stories, REST APIs, "
            "Android and iOS experience, CI/CD pipelines."
        ),
        "primary_categories": ["Mobile Application Development", "Full Stack Development", "Product Management"],
    },
]
