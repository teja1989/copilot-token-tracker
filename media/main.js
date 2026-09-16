(function () {
  const vscodeApi = acquireVsCodeApi();

  const emptyState = document.getElementById('empty-state');
  const content = document.getElementById('content');
  const statRequests = document.getElementById('stat-requests');
  const statCost = document.getElementById('stat-cost');
  const statPremium = document.getElementById('stat-premium');

  function themeColor(varName, fallback) {
    const value = getComputedStyle(document.body).getPropertyValue(varName).trim();
    return value || fallback;
  }

  const palette = [
    themeColor('--vscode-charts-blue', '#3794ff'),
    themeColor('--vscode-charts-green', '#89d185'),
    themeColor('--vscode-charts-orange', '#d18616'),
    themeColor('--vscode-charts-purple', '#b180d7'),
    themeColor('--vscode-charts-red', '#f14c4c'),
    themeColor('--vscode-charts-yellow', '#cca700')
  ];

  const gridColor = themeColor('--vscode-widget-border', 'rgba(128,128,128,0.2)');
  const textColor = themeColor('--vscode-foreground', '#cccccc');

  Chart.defaults.color = textColor;
  Chart.defaults.borderColor = gridColor;
  Chart.defaults.font.family = getComputedStyle(document.body).getPropertyValue('--vscode-font-family') || undefined;

  let modelChart;
  let agentChart;

  function renderModelChart(byModel) {
    const ctx = document.getElementById('model-chart');
    const labels = byModel.map((m) => m.model);
    const data = {
      labels,
      datasets: [
        { label: 'Input tokens', data: byModel.map((m) => m.totalInputTokens), backgroundColor: palette[0] },
        { label: 'Output tokens', data: byModel.map((m) => m.totalOutputTokens), backgroundColor: palette[1] }
      ]
    };
    if (modelChart) {
      modelChart.data = data;
      modelChart.update();
      return;
    }
    modelChart = new Chart(ctx, {
      type: 'bar',
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
        plugins: {
          tooltip: {
            callbacks: {
              afterBody: (items) => {
                const m = byModel[items[0].dataIndex];
                const parts = [];
                if (m.totalUsdCost > 0) parts.push(`Est. cost: $${m.totalUsdCost.toFixed(4)}`);
                if (m.totalPremiumRequestUnits > 0) parts.push(`Premium units: ${m.totalPremiumRequestUnits.toFixed(1)}`);
                if (m.totalCachedTokens > 0) parts.push(`Cached tokens: ${m.totalCachedTokens}`);
                return parts;
              }
            }
          }
        }
      }
    });
  }

  function renderAgentChart(byAgent) {
    const ctx = document.getElementById('agent-chart');
    const labels = byAgent.map((a) => a.agentName);
    const data = {
      labels,
      datasets: [
        { label: 'Chat requests', data: byAgent.map((a) => a.chatRequestCount), backgroundColor: palette[0] },
        { label: 'Tool calls', data: byAgent.map((a) => a.toolCallCount), backgroundColor: palette[2] }
      ]
    };
    if (agentChart) {
      agentChart.data = data;
      agentChart.update();
      return;
    }
    agentChart = new Chart(ctx, {
      type: 'bar',
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } },
        plugins: {
          tooltip: {
            callbacks: {
              afterBody: (items) => {
                const a = byAgent[items[0].dataIndex];
                return a.toolErrorCount > 0 ? [`Tool errors: ${a.toolErrorCount}`] : [];
              }
            }
          }
        }
      }
    });
  }

  function render(payload) {
    if (!payload.dbFound) {
      emptyState.classList.remove('hidden');
      content.classList.add('hidden');
      return;
    }
    emptyState.classList.add('hidden');
    content.classList.remove('hidden');

    statRequests.textContent = String(payload.totals.requests);
    statCost.textContent = payload.totals.usdCost > 0 ? `$${payload.totals.usdCost.toFixed(2)}` : '—';
    statPremium.textContent = payload.totals.premiumUnits > 0 ? payload.totals.premiumUnits.toFixed(1) : '—';

    renderModelChart(payload.byModel);
    renderAgentChart(payload.byAgent);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message?.type === 'usageData') {
      render(message.payload);
    }
  });

  vscodeApi.postMessage({ type: 'requestData' });
})();
