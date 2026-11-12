// Names of common tools, languages, frameworks, databases and platforms.
//
// Why this list exists: the guardrail must catch a rewrite that names a technology the user never
// listed. Most of those names come from the job description or the profile, but a model can also
// invent one from its own memory ("also deployed with Terraform"). This list is the safety net for
// that case. It is plain data: when a real job description shows a gap, add the name here.
// Spelling matters only for display; matching is case-insensitive (see terms.js for the exceptions).

export const KNOWN_TECH = [
  // languages
  'JavaScript', 'TypeScript', 'Python', 'Java', 'Kotlin', 'Swift', 'Go', 'Rust', 'C++', 'C#', 'C',
  'Ruby', 'PHP', 'Scala', 'R', 'SQL', 'Bash', 'Perl', 'Dart', 'Elixir', 'Haskell', 'MATLAB', 'Objective-C',
  // front end
  'React', 'Angular', 'Vue', 'Svelte', 'Next.js', 'Nuxt', 'Redux', 'jQuery', 'Tailwind', 'Bootstrap',
  'Sass', 'HTML', 'CSS', 'Webpack', 'Vite', 'Gatsby', 'Flutter', 'React Native',
  // back end
  'Node.js', 'Express', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Spring', 'Spring Boot', 'Rails',
  'Laravel', '.NET', 'ASP.NET', 'GraphQL', 'gRPC',
  // data and machine learning
  'TensorFlow', 'PyTorch', 'scikit-learn', 'Pandas', 'NumPy', 'Keras', 'Spark', 'Hadoop', 'Kafka',
  'RabbitMQ', 'Airflow', 'Snowflake', 'BigQuery', 'Tableau', 'Power BI', 'OpenAI', 'LangChain', 'Hugging Face',
  // databases
  'MongoDB', 'PostgreSQL', 'MySQL', 'SQLite', 'Redis', 'Elasticsearch', 'DynamoDB', 'Cassandra', 'Oracle',
  'Firebase', 'Supabase', 'Mongoose', 'Prisma',
  // cloud and devops
  'AWS', 'Azure', 'GCP', 'Google Cloud', 'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Jenkins',
  'GitHub Actions', 'GitLab', 'CircleCI', 'Prometheus', 'Grafana', 'Nginx', 'Linux', 'Heroku', 'Vercel',
  'Netlify', 'Cloudflare', 'EC2', 'S3', 'Lambda', 'Datadog', 'Sentry', 'Splunk',
  // tools and practices that are named products
  'Git', 'GitHub', 'Jira', 'Figma', 'Postman', 'Jest', 'Cypress', 'Selenium', 'Playwright', 'Excel',
  'Salesforce', 'SAP', 'Scrum', 'Kanban', 'Confluence', 'Slack', 'Notion',
];
