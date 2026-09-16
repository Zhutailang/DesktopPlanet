# Jovian Desk · 桌面太阳系

Windows x64 透明桌面太阳系。程序使用 Electron、Three.js 和 TypeScript，常用控制集中在窗口下方中央，适合常驻副屏或小屏幕。

## 运行与操作

打开 `outputs/Jovian Desk-win32-x64`，双击 `Jovian Desk.exe`。必须保留 EXE 旁边的 `resources`、DLL 等文件；运行不需要联网，也不需要另装 Node.js。

- 底栏下拉框可在太阳系总览、地月系统、火星系统、木星系统等视图间切换；“太阳系”按钮或 Backspace 返回总览。
- 在总览中双击一颗行星，可直接进入该行星系统。切换时使用淡化与镜头飞行过渡，过渡时长可在“显示”页调整。
- 按住星体拖动可旋转观察，滚轮缩放。Alt + 拖动星体，或拖动底栏左侧名称，可移动窗口。
- 底栏“铺满屏幕”或 F11 会铺满当前显示器；再次点击、F11 或 Esc 恢复。
- 空格暂停或继续时间，R 重置视角，S 打开设置；Ctrl + Alt + J 和托盘菜单也可打开设置。

小副屏用法：先拖到目标屏幕，再点“铺满屏幕”。窗口松手后会自动收进目标屏幕，铺满状态、位置和显示器会在下次启动时恢复。320×240 起的紧凑布局仍保留完整控制和可滚动设置。

## 内置天体

太阳系总览只显示太阳、八颗主要行星、行星轨道和火星与木星之间的小行星带，不绘制卫星，便于看清层级和距离关系。

行星系统包含 21 颗主要卫星：地球 1 颗；火星 2 颗；木星 4 颗伽利略卫星；土星 7 颗；天王星 5 颗；海王星 2 颗。水星和金星没有天然卫星。各系统持续独立计时，切换视图不会重置自转、公转或相位。

## 配置与自定义规则

设置实时生效，保存在 `user-data/config.json`；窗口状态保存在 `user-data/window-state.json`。配置面板可导入、导出 JSON 或恢复默认值。

- “太阳系”页可显示或隐藏轨道、小行星带，调整小行星密度，并新增最多 24 个行星系统。自定义行星可命名、删除，也可设置半径、颜色、表面、自转、轴倾角、大气、扁率和完整公转轨道。
- 每个行星各自保存星环和卫星数组。星环可设置内径、宽度、颜色和密度；每个行星最多 32 颗卫星。
- 卫星支持名称、大小、颜色、表面、参考平面、半长轴、离心率、倾角、升交点、近心点、相位、自转周期、公转周期、顺逆方向和单独显示开关。
- 半径和轨道距离使用 km，周期使用小时。输入会检查 ID 重复、数值范围、近日点或近行星点穿过母体等错误；无效配置不会覆盖当前配置。
- “显示”页可开关 Bloom 光晕，调整光晕强度和扩散范围。光晕随星体颜色与亮部变化，保留透明背景，轮廓外的光晕不拦截桌面点击。

太阳系总览和行星系统使用独立时间倍率，默认分别为 864,000× 与 1,200×；暂停为全局状态。改变周期或倍率会保持当前相位，直接改变“轨道相位”才会重新定位天体。

旧版 v1 木星配置会自动迁移到 v2，并保留原来的木星、星环、自定义卫星和显示参数。首次迁移时，程序会在同一用户数据目录保存 `config-v1-backup-时间戳.json`。

## 比例与真实程度

“展示比例”对太阳系距离使用单调对数压缩，并放大天体；行星系统会压缩卫星轨道和放大卫星，同时保持轨道顺序、星环外卫星的安全间距和可编辑大小。“真实比例”使用一致的大小与距离比例，天体可能非常小。

行星和主要卫星的平均半径、轨道与周期参考 NASA/JPL 数据。行星和月球使用公开贴图；木星使用 Hubble 2015 全球图；其余卫星采用程序化近似表面。默认相位用于构图，不是当前星历位置。轨道由开普勒椭圆推进，不包含 N 体摄动、实时星历或大气流体模拟。

## 从源码运行

建议使用 Node.js 24 LTS：

```powershell
npm install
npm run build
npm start
```

验证命令：

```powershell
npm test
npm run test:desktop
npm run test:layout
npm run package
```

`test:desktop` 在真实 Electron 窗口中检查八个行星系统、过渡、自定义行星和卫星、导入导出及重启恢复。`test:layout` 检查 1024×600、800×480、480×320 和 320×240，以及多显示器铺满和还原。

## 数据与图像来源

- [NASA Planetary Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/)
- [JPL Satellite Physical Parameters](https://ssd.jpl.nasa.gov/sats/phys_par/)
- [JPL Satellite Mean Elements](https://ssd.jpl.nasa.gov/sats/elem/)
- [NASA/STScI Hubble Jupiter map](https://svs.gsfc.nasa.gov/12021/)
- [Solar System Scope textures](https://www.solarsystemscope.com/textures/)，Solar System Scope / INOVE，按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 使用

Image credit for the Jupiter map: NASA’s Goddard Space Flight Center / Space Telescope Science Institute. No NASA endorsement is implied. 完整许可证见 `THIRD_PARTY_NOTICES.md`。
