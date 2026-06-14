function syncTabBar(page, selected) {
  if (!page || typeof page.getTabBar !== "function") return;
  const tabBar = page.getTabBar();
  if (tabBar) {
    tabBar.setData({ selected });
  }
}

module.exports = { syncTabBar };
