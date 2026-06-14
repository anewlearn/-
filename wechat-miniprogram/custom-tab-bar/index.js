Component({
  data: {
    selected: 0,
    list: [
      { pagePath: "/pages/home/home", text: "首页", icon: "⌂" },
      { pagePath: "/pages/wardrobe/wardrobe", text: "衣橱", icon: "▥" },
      { pagePath: "/pages/capture/capture", text: "拍照", icon: "⌾", center: true },
      { pagePath: "/pages/outfit/outfit", text: "搭配", icon: "✧" },
      { pagePath: "/pages/profile/profile", text: "我的", icon: "○" }
    ]
  },

  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index || 0);
      const path = event.currentTarget.dataset.path;
      this.setData({ selected: index });
      wx.switchTab({ url: path });
    }
  }
});
