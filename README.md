# WiFiMedic Pro · 网络医生

一款面向 Windows 的中文网络与 Wi-Fi 诊断工具，使用 Electron 构建。提供一屏式健康总览、14 阶段全面体检、连通性测试、网络测速、Wi-Fi 扫描与密码查看、常见网络修复以及 HTML / JSON / TXT 报告导出。

![WiFiMedic Pro 首页](docs/dashboard-120.png)

## 成品下载

| 文件 | 说明 |
| --- | --- |
| [WiFiMedic-Pro-1.0.0-Portable.exe](artifacts/WiFiMedic-Pro-1.0.0-Portable.exe) | Windows 10 / 11 64 位便携版，无需安装 |
| [WiFiMedic-Android-1.0.0.apk](artifacts/WiFiMedic-Android-1.0.0.apk) | Android 伴侣版，需允许安装未知应用 |
| [WiFiMedic-1.0.0-源码.zip](artifacts/WiFiMedic-1.0.0-源码.zip) | 源码与构建脚本快照 |
| [WiFiMedic-使用说明.md](artifacts/WiFiMedic-使用说明.md) | 完整功能、操作与限制说明 |
| [SHA256SUMS.txt](artifacts/SHA256SUMS.txt) | 成品 SHA-256 校验值 |

> Windows 便携版未签名，首次运行可能触发 SmartScreen。请核对 SHA-256 后再运行。
>
> 发布签名密钥不随仓库公开。源码中的 Android 签名脚本改为读取环境变量；需要更新 APK 时请使用你自己的 keystore。

## 主要功能

- **健康总览**：自动识别当前主用通道，展示健康评分、链路、IP、网关、DNS、代理、延迟、丢包与待处理问题。
- **全面体检**：14 个阶段覆盖系统环境、路由、网卡、DHCP、网关、DNS、厂商节点、TCP 443、HTTP、Wi-Fi 链路、安全、代理、MTU 和路由追踪。
- **连通性测试**：Ping 国内厂商、公共 DNS、默认网关及可选国际节点，输出延迟、丢包与抖动。
- **速度与稳定**：下载 / 上传测速、实时延迟曲线和稳定性采样。
- **Wi-Fi 管理**：扫描周边网络、分析信道、查看已保存网络密码，并提供复制 / 验证流程。
- **修复工具**：DNS 刷新、Winsock 重置、网卡重启等常见修复；需要管理员权限的项目会明确标注并支持管理员重启。
- **报告中心**：历史体检、HTML / JSON / TXT 导出、本机设置与界面字号调整。
- **中文界面**：全程中文、浅色 / 深色主题、标准 / 舒适 / 特大字号，支持 1080p 一屏式首页。

## 项目结构

```text
android/      Android 原生 WebView 伴侣版源码与构建脚本
build/        应用图标与打包资源
src/          Electron 主进程、预加载脚本、后端能力与渲染层
artifacts/    已构建成品与发布说明
docs/         截图等文档资源
package.json  Electron 构建配置
```

## 本地运行

```powershell
npm install
npm start
```

Windows 打包：

```powershell
npm run dist
```

构建 Windows 便携版需要 Node.js、npm 以及项目依赖；打包配置见 `package.json`。

## 构建 Android APK

Android 工具链（JDK、Android SDK / build-tools）未纳入仓库，需要按本机环境准备。构建脚本默认使用项目根目录下的 `.toolchain`，也可以在首次编译前按需调整路径。

签名信息通过环境变量提供，不要提交 keystore 或密码：

```powershell
$env:WIFIMEDIC_KEYSTORE = 'C:\path\to\your-release.jks'
$env:WIFIMEDIC_STORE_PASS = 'your-store-password'
$env:WIFIMEDIC_KEY_PASS = 'your-key-password'   # 可选，默认同 store password
$env:WIFIMEDIC_KEY_ALIAS = 'wifimedic'           # 可选
powershell -ExecutionPolicy Bypass -File android\build.ps1
```

## 隐私与限制

- 报告、设置和修复日志仅保存在本机；不包含遥测和广告 SDK。
- 体检、Ping、DNS、HTTP、TCP 和测速会向对应目标发起网络请求，这是检测功能所必需的。
- Wi-Fi 密码读取需要 Windows 的 WLAN AutoConfig（WlanSvc）服务和可用无线网卡；无无线网卡时会显示降级提示。
- Android 版已完成构建、签名和静态校验；部分系统限制仍建议在真机复核。
- 本工具用于网络诊断与常见修复，不替代运营商、路由器厂商或专业网络运维。

## 许可证

MIT License，详见 [LICENSE](LICENSE)。
