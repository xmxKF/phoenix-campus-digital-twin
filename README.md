# 凤凰山北 · 园区与数字孪生

这是厂区概念展示网站的独立静态发布包。

- [厂区外部浏览](viewer-v2/)
- [厂区内部数字孪生](viewer-twin/)
- [模型覆盖与模拟边界](public/model-coverage.html)
- [建筑 CAD 图纸与可编辑源文件](output/cad/)

模型由图像与公开参考资料补全，尺寸、室内和工艺布局属于概念推定。所有控制、反馈、告警和制造物流均为本地模拟，未连接真实设备。

发布包保留完整树叶、全部几何与实例；网页版本优化地面、屋顶等图像贴图的编码，并无损压缩几何索引。原始 GLB 和 Blender 源文件仍可下载。网页 gzip 解压后与对应网页 GLB 逐字节一致，内部建筑模型保持无损压缩。只加载当前查看的建筑，CAD 和 Blender 文件按点击下载。

Three.js 与 Draco 许可证随 viewer/vendor/ 提供；环境素材来源及公开资料见 analysis/v2/external-reference-register.md。

## Cloudflare Pages

连接本仓库，生产分支选择 main。框架预设选“无”，构建命令填 `node build-cloudflare.mjs`，构建输出目录填 `cloudflare-dist`，根目录留空，环境变量无需添加。

Cloudflare 首页进入内部数字孪生；外部浏览位于 `/viewer-v2/`。保留整个共享资源目录，请勿将根目录设成 viewer-twin。

构建检查每个资产的 25 MiB 上限。两项超限原始下载（建筑 PDF 合集与原始外观 GLB）通过精确重定向继续从现有 GitHub Pages 获取，因此该 GitHub Pages 站点需要保持可用。所有常规浏览模型均由 Cloudflare 提供，模型几何和树叶保持原样。构建另添加顶层 404 页面，以免缺失模型错误返回首页 HTML。
