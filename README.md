# 凤凰山北 · 园区与数字孪生

这是厂区概念展示网站的独立静态发布包。

- [厂区外部浏览](viewer-v2/)
- [厂区内部数字孪生](viewer-twin/)
- [模型覆盖与模拟边界](public/model-coverage.html)
- [建筑 CAD 图纸与可编辑源文件](output/cad/)

模型由图像与公开参考资料补全，尺寸、室内和工艺布局属于概念推定。所有控制、反馈、告警和制造物流均为本地模拟，未连接真实设备。

发布包保留完整树叶几何，压缩文件解压后与原 GLB 字节一致。只加载当前查看的建筑，CAD 和 Blender 文件按点击下载。

Three.js 与 Draco 许可证随 viewer/vendor/ 提供；环境素材来源及公开资料见 analysis/v2/external-reference-register.md。
