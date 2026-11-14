/** Studio UI + svg3dx standard tag labels (zh / en). */

export type Locale = "zh" | "en";

export type MessageTree = {
  [key: string]: string | MessageTree;
};

/**
 * Standard svg3dx tag / section names.
 * Keep in sync when adding editor tree vocabulary.
 */
export const TAG_LABELS = {
  model: { zh: "模型", en: "model" },
  defs: { zh: "定义", en: "defs" },
  group: { zh: "组", en: "group" },
  style: { zh: "样式", en: "style" },
  use: { zh: "引用", en: "use" },
} as const;

export type TagKey = keyof typeof TAG_LABELS;

export const messages: Record<Locale, MessageTree> = {
  zh: {
    app: {
      nodes: "节点",
      notLoaded: "尚未加载文档",
      backBrowse: "返回浏览",
      unsaved: "未保存",
      addPrimitive: "新增体元",
      export: "导出",
      save: "保存",
      styleParams: "样式参数",
      nodeParams: "节点参数",
      addParam: "添加参数",
      addGroup: "添加组",
      noParams: "暂无参数，点击上方添加",
      clickNode: "点击左侧节点查看详情",
      saved: "已保存到本地缓存",
      downloaded: "已开始下载",
      updatedStyle: "已更新",
      addedGroup: "已新增组",
      addedPrimitive: "已新增",
      fileMissing: "文件不存在或已移除",
      attributes: "属性",
      classProps: "类属性",
      resolved: "解析结果",
      noNodeParams: "无参数",
      noNodeStyles: "无样式",
      noClassProps: "无类定义属性",
      langZh: "中文",
      langEn: "English",
    },
    tag: Object.fromEntries(
      Object.entries(TAG_LABELS).map(([k, v]) => [k, v.zh])
    ) as Record<TagKey, string>,
    mode: {
      solid: "实体",
      wireframe: "线框",
      "lite-solid": "轻量化实体",
      "hidden-line": "隐藏线",
    },
  },
  en: {
    app: {
      nodes: "Nodes",
      notLoaded: "Document not loaded",
      backBrowse: "Back",
      unsaved: "Unsaved",
      addPrimitive: "Add primitive",
      export: "Export",
      save: "Save",
      styleParams: "Style params",
      nodeParams: "Node props",
      addParam: "Add param",
      addGroup: "Add group",
      noParams: "No params — click Add above",
      clickNode: "Select a node to inspect",
      saved: "Saved to local cache",
      downloaded: "Download started",
      updatedStyle: "Updated",
      addedGroup: "Group added",
      addedPrimitive: "Added",
      fileMissing: "File missing or removed",
      attributes: "Attributes",
      classProps: "Class props",
      resolved: "Resolved",
      noNodeParams: "No params",
      noNodeStyles: "No styles",
      noClassProps: "No class properties",
      langZh: "中文",
      langEn: "English",
    },
    tag: Object.fromEntries(
      Object.entries(TAG_LABELS).map(([k, v]) => [k, v.en])
    ) as Record<TagKey, string>,
    mode: {
      solid: "solid",
      wireframe: "wireframe",
      "lite-solid": "lite-solid",
      "hidden-line": "hidden-line",
    },
  },
};
