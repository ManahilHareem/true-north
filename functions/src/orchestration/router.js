function routeTask(task) {
  const normalized = String(task || "").toLowerCase();

  if (normalized.includes("remember") || normalized.includes("recap") || normalized.includes("summar")) {
    return "memory";
  }

  if (normalized.includes("recommend") || normalized.includes("should i") || normalized.includes("best option")) {
    return "recommendation";
  }

  if (normalized.includes("research") || normalized.includes("compare") || normalized.includes("analyze")) {
    return "research";
  }

  return "knowledge";
}

module.exports = { routeTask };
