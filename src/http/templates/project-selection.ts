/**
 * Project Selection Page HTML Template
 */

export interface ProjectGroup {
  organization: {
    name: string;
  };
  projects: Array<{
    id: string;
    name: string;
    appkey: string;
    region: string;
  }>;
}

export interface ProjectSelectionPageOptions {
  stateId: string;
  projectGroups: ProjectGroup[];
  selectProjectEndpoint: string;
}

export function renderProjectSelectionPage(options: ProjectSelectionPageOptions): string {
  const { stateId, projectGroups, selectProjectEndpoint } = options;

  const projectsHtml = projectGroups.length > 0
    ? projectGroups.map(group => `
      <div class="org-section">
        <div class="org-name">${escapeHtml(group.organization.name)}</div>
        ${group.projects.map(project => `
          <form method="POST" action="${selectProjectEndpoint}">
            <input type="hidden" name="state_id" value="${escapeHtml(stateId)}">
            <input type="hidden" name="project_id" value="${escapeHtml(project.id)}">
            <button type="submit" class="project-card">
              <div class="project-info">
                <div class="project-name">${escapeHtml(project.name)}</div>
                <div class="project-url">https://${escapeHtml(project.appkey)}.${escapeHtml(project.region)}.insforge.app</div>
              </div>
              <span class="project-region">${escapeHtml(project.region)}</span>
              <span class="project-arrow">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M7 4L13 10L7 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </span>
            </button>
          </form>
        `).join('')}
      </div>
    `).join('')
    : `
      <div class="no-projects">
        <p>No active projects found.</p>
        <p>Please create a project in the InsForge dashboard first.</p>
      </div>
    `;

  return `<!DOCTYPE html>
<html>
<head>
  <title>Select Project - InsForge MCP</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0F0F0F;
      color: #e5e5e5;
      min-height: 100vh;
      padding: 60px 20px;
      position: relative;
    }

    /* Dot grid background pattern */
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-image: radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px);
      background-size: 24px 24px;
      pointer-events: none;
      z-index: 0;
    }

    /* Gradient overlay */
    body::after {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 400px;
      background: radial-gradient(ellipse at top, rgba(110, 231, 183, 0.08) 0%, transparent 70%);
      pointer-events: none;
      z-index: 0;
    }

    .container {
      max-width: 560px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    .logo {
      text-align: left;
      margin-bottom: 20px;
    }

    h1 {
      font-size: 32px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 12px;
      text-align: center;
      letter-spacing: -0.02em;
    }

    .subtitle {
      color: #a0a0a0;
      text-align: center;
      margin-bottom: 48px;
      font-size: 16px;
      font-weight: 400;
    }

    .org-section {
      margin-bottom: 32px;
    }

    .org-name {
      font-size: 12px;
      font-weight: 600;
      color: #6EE7B7;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 16px;
      padding-left: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .org-name::before {
      content: '';
      width: 6px;
      height: 6px;
      background: #6EE7B7;
      border-radius: 50%;
    }

    .project-card {
      background: linear-gradient(135deg, #1C1C1C 0%, #171717 100%);
      border: 1px solid #262626;
      border-radius: 8px;
      padding: 20px 24px;
      margin-bottom: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: relative;
      overflow: hidden;
    }

    .project-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(135deg, rgba(110, 231, 183, 0.05) 0%, transparent 50%);
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    .project-card:hover {
      border-color: #6EE7B7;
      transform: translateY(-2px);
      box-shadow: 0 8px 32px rgba(110, 231, 183, 0.1);
    }

    .project-card:hover::before {
      opacity: 1;
    }

    .project-card:active {
      transform: translateY(0);
    }

    .project-info {
      flex: 1;
      position: relative;
      z-index: 1;
    }

    .project-name {
      font-weight: 600;
      font-size: 16px;
      color: #fff;
      margin-bottom: 6px;
      letter-spacing: -0.01em;
    }

    .project-url {
      font-size: 13px;
      color: #6EE7B7;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      opacity: 0.8;
    }

    .project-region {
      font-size: 11px;
      font-weight: 600;
      color: #6EE7B7;
      background: rgba(110, 231, 183, 0.1);
      border: 1px solid rgba(110, 231, 183, 0.2);
      padding: 6px 12px;
      border-radius: 20px;
      margin-left: 16px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      position: relative;
      z-index: 1;
    }

    .project-arrow {
      color: #6EE7B7;
      opacity: 0;
      transform: translateX(-8px);
      transition: all 0.2s ease;
      margin-left: 12px;
      position: relative;
      z-index: 1;
    }

    .project-card:hover .project-arrow {
      opacity: 1;
      transform: translateX(0);
    }

    .no-projects {
      text-align: center;
      color: #525252;
      padding: 60px 40px;
      background: linear-gradient(135deg, #1C1C1C 0%, #171717 100%);
      border: 1px solid #262626;
      border-radius: 8px;
    }

    .no-projects p {
      margin-bottom: 8px;
    }

    .no-projects p:last-child {
      margin-bottom: 0;
    }

    .cancel-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      margin-top: 32px;
      color: #737373;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      padding: 12px;
      border-radius: 6px;
      transition: all 0.2s ease;
    }

    .cancel-link:hover {
      color: #a3a3a3;
      background: rgba(255, 255, 255, 0.03);
    }

    form { display: contents; }

    button.project-card {
      width: 100%;
      text-align: left;
      font: inherit;
    }

    /* Footer branding */
    .footer {
      text-align: center;
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid #262626;
    }

    .footer-text {
      font-size: 12px;
      color: #525252;
    }

    .footer-text a {
      color: #6EE7B7;
      text-decoration: none;
      transition: opacity 0.2s;
    }

    .footer-text a:hover {
      opacity: 0.8;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <img alt="InsForge Logo" width="100" height="24" decoding="async" data-nimg="1" style="color:transparent" src="https://insforge.dev/assets/logos/logo_text.svg">
    </div>

    <h1>Select a Project</h1>
    <p class="subtitle">Choose the project to connect with your coding agent</p>

    ${projectsHtml}

    <a href="javascript:history.back()" class="cancel-link">Cancel</a>

  </div>
</body>
</html>`;
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, char => htmlEscapes[char]);
}
