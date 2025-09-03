# 架構

## 概觀

```text
+------------------------------------------------------------------------------+
|                                                                              |
|                           Git-Credential-Manager                             |
|                                                                              |
+-+-------------+--------------+-----+---------------------+-----------------+-+
  |             |              |     |                     |                 |
  |             |              |     |             Windows |         Windows |
  |             |              |     |                     |                 |
  | +-----------v-----------+  |     |    +----------------v---------------+ |
  | |                       |  |     |    |                                | |
  | |        GitHub                        Core.UI              |
|                                      |  |                                    |
+--------------------------------------+  +------------------------------------+
```

Git Credential Manager (GCM) 的建構目標是與 Git 主機和平台/作業系統
無關。大部分的共享邏輯 (指令執行、抽象平台
子系統等) 都在 `Core` 類別
函式庫 (C#) 中。該函式庫同時適用於 .NET Standard 和 .NET Framework。

> **注意**
>
> 同時也直接針對 .NET Framework 的原因是
> `Microsoft.Identity.Client` ([MSAL.NET][msal])
> 函式庫需要 .NET Framework 目標，才能顯示嵌入式網頁
> 瀏覽器驗證彈出視窗 (在 Windows 平台上)。
>
> 現在 MSAL.NET 中存在擴充點，這意味著我們可以插入
> 我們自己的瀏覽器彈出視窗處理程式碼到 .NET 上，這代表 Windows 和
> Mac 都能支援。我們尚未著手研究這個部分。
>
> 更多資訊請參閱 [GCM issue 113][issue-113]。

GCM 的進入點位於 `Git-Credential-Manager`
專案中，它是一個同時適用於 .NET 和 .NET Framework 的主控台應用程式。
此專案會產生 `git-credential-manager(.exe)` 可執行檔，並且
只包含極少的程式碼——註冊所有支援的主機提供者以及
執行 `Core` 中的 `Application` 物件。

提供者有自己的專案/組件，它們依賴於
`Core` 核心組件，並且是主要
進入點應用程式 `Git-Credential-Manager` 的相依項目。這些二進位檔中的程式碼
預期會在所有支援的平台上執行，並且通常 (請參閱上方的 MSAL.NET 說明
) 不包含任何圖形化使用者介面；它們使用終端機提示
而已。

當提供者需要某些平台特定的互動或圖形化使用者
介面時，建議的模型是擁有一個獨立的「輔助」可執行檔，
由共享的核心二進位檔呼叫。目前 Bitbucket 和 GitHub
提供者各自有一個 WPF (僅限 Windows) 的輔助可執行檔，用來顯示
驗證提示與訊息。

`Core.UI` 專案是一個 WPF (僅限 Windows) 組件
其中包含在提供者之間共享的通用 WPF 元件與樣式
Windows 上的輔助程式。

### 跨平台 UI

我們希望能將僅限 WPF/Windows 的輔助程式遷移至 [Avalonia][avalonia]
以獲得跨平台的圖形化使用者介面支援。請參閱
[GCM issue 136][issue-136] 以了解此項工作的最新進度。

### Microsoft 驗證

對於使用 Microsoft 帳戶或 Azure Active Directory 的驗證，情況
會有些不同。`MicrosoftAuthentication` 元件位於
`Core` 核心組件中，而非與某個
特定的主機提供者捆綁。此舉是為了允許任何未來可能希望
與 Microsoft 帳戶或 Azure Active Directory 整合的服務，可以
使用這個可重複使用的驗證元件。

## 非同步程式設計

GCM 在程式碼庫中幾乎所有適當的地方，都使用了 .NET 和 C# 的 `async`/`await` 模型
因為請求通常最終會導向
某個時間點的網路。

## 指令執行

```text
                             +---------------+
                             |               |
                             |      Git      |
                             |               |
                             +---+-------^---+
                                 |       |
                             +---v---+---+---+
                             | stdin | stdout|
                             +---+---+---^---+
                                 |       |
                            (2)  |       |  (7)
                          Select |       | Serialize
                         Command |       | Result
                                 |       |
                     (3)         |       |
                    Select       |       |
+---------------+  Provider  +---v-------+---+
| Host Provider |            |               |
|   Registry        Command    |
|               |            |               |
+-------^-------+            +----+------^---+
        |                         |      |
        |                   (4)   |      |   (6)
        |                Execute  |      |  Return
        |              Operation  |      |  Result
        |    (1)                  |      |
        |  Register          +----v------+---+
        |                    |               |
        +--------------------+ Host Provider |
                             |               |
                             +-------^-------+
                                     |
                   (5) Use services  |
                                     |
                             +-------v-------+
                             |    Command    |
                             |    Context    |
                             +---------------+
```

Git Credential Manager 維護一組已知的指令，包括
`Get|Store|EraseCommand`，以及用於安裝和說明/用法的指令。

GCM 也維護一組已知的、已註冊的主機提供者，這些提供者實作
`IHostProvider` 介面。提供者透過 [`Core.Program`][core-program] 中的 `RegisterProvider`
方法，將提供者的執行個體加入 `Application` 物件中來自行註冊。
`GenericHostProvider` 會在最後註冊，以便它可以作為一個通用的處理方式來處理所有其他
基於 HTTP 的遠端，並提供基本的使用者名稱/密碼驗證，以及
偵測是否存在 Windows 整合式驗證（Kerberos、NTLM、
Negotiate）支援 (1)。

對於 GCM 的每次呼叫，命令列上的第一個參數會
與已知的命令進行比對，如果成功比對，來自 Git 的輸入
（透過標準輸入）會被反序列化，然後執行該命令 (2)。

`Get|Store|EraseCommand` 會查詢主機提供者註冊表以尋找最適合的
主機提供者。預設的註冊表實作會依序詢問每個已註冊的
提供者是否理解該請求，來選擇主機提供者。使用者可以分別透過
[`credential.provider`][credential-provider] 設定或 [`GCM_PROVIDER`][gcm-provider]
環境變數來覆寫提供者的選擇 (3)。

`Get|Store|EraseCommand` 會呼叫 `IHostProvider` 上對應的
`Get|Store|EraseCredentialAsync` 方法，並將來自 Git 的請求連同
`ICommandContext` 的執行個體一起傳遞過去 (4)。然後，
主機提供者可以利用命令脈絡中可用的各種服務來完成所請求的操作 (5)。

一旦憑證被建立、擷取、儲存或清除後，主機提供者會將憑證
（僅限於 `get` 操作）傳回給呼叫的命令 (6)。接著，憑證會被序列化並透過標準
輸出傳回給 Git (7)，然後 GCM 會以成功的結束代碼終止。

## 主機提供者

主機提供者實作 `IHostProvider` 介面。他們可以選擇
直接實作該介面，也可以衍生自 `HostProvider`
抽象類別（它本身也實作 `IHostProvider` 介面）。

`HostProvider` 抽象類別實作了
`Get|Store|EraseCredentialAsync` 方法，並改為提供
`GenerateCredentialAsync` 抽象方法和 `GetServiceName` 虛擬
方法。對 `get`、`store` 或 `erase` 的呼叫會先呼叫
`GetServiceName`，它應該為提供者和請求傳回一個穩定且唯一的值。
這個值構成憑證存放區中任何已儲存憑證的相關屬性的一部分。
在 `get` 操作期間，會查詢憑證存放區中是否有具有該服務名稱的現有憑證。
如果找到憑證，則會立即傳回。同樣地，對 `store`
和 `erase` 的呼叫會被自動處理，以根據服務名稱儲存憑證，以及清除
符合服務名稱的憑證。方法被實作為 `virtual`，
這意味著您隨時可以覆寫此行為，例如在 `erase` 請求時清除其他
自訂快取，而無需重新實作查詢/儲存憑證的邏輯。

`GetServiceName` 的預設實作通常對大多數提供者來說已經足夠。
它會從 Git 的輸入參數中傳回計算出的遠端 URL（不含結尾的斜線）——
`<protocol>://<host>[/<path>]`——即使提供了使用者名稱也不會包含在內。

主機提供者會透過 `IHostProvider.IsSupported(InputArguments)` 方法，
按照優先順序（然後是註冊順序）依序被查詢，並傳入從 Git 收到的輸入。
如果提供者辨識出該請求，例如透過比對已知的主機名稱，它可以傳回 `true`。
如果提供者想要取消並中止驗證請求，例如這是一個對已知主機的 HTTP（而非
HTTPS）請求，它仍然應該傳回 `true`，然後再取消該請求。

主機提供者也可以透過 `IHostProvider.IsSupported(HttpResponseMessage)`
方法被查詢，並傳入對遠端 URI 進行 HEAD 呼叫所得到的回應訊息。
這對於根據標頭值偵測地端執行個體很有用。GCM
只會在相同註冊優先順序的其他提供者都沒有對 `InputArguments` 多載傳回 `true` 的情況下，
才會透過此方法多載查詢提供者。

根據來自 Git 的請求，將會呼叫 `GetCredentialAsync`（用於 `get`
請求）、`StoreCredentialAsync`（用於 `store` 請求）或
`EraseCredentialAsync`（用於 `erase` 請求）其中之一。`InputArguments` 參數
包含從 Git/呼叫者透過標準輸入傳遞的請求資訊；
與傳遞給 `IsSupported` 的相同。

`get` 操作的傳回值必須是 Git 可用來完成驗證的 `ICredential`。

> **注意：**
>
> 憑證也可以是一個使用者名稱和密碼皆為空字串的執行個體，
> 以向 Git 發出信號，讓 cURL 使用「任何驗證」
> 偵測——通常用於 Windows 整合式驗證。

`store` 和 `erase` 操作沒有傳回值，因為 Git 會忽略
這些命令的任何輸出或結束代碼。這些操作的失敗最好透過
寫入標準錯誤流 (`ICommandContext.Streams.Error`) 來傳達。

## 命令脈絡

`ICommandContext` 包含許多服務，這些服務對於
與各種平台子系統（例如檔案系統或環境變數）互動很有用。
命令脈絡上的所有服務都以介面的形式公開，以利於
在不同作業系統和平台之間的測試和移植。

元件|描述
-|-
CredentialStore|一個由作業系統控制的安全位置，用於儲存和擷取 `ICredential` 物件。
Settings|對所有 GCM 設定的抽象化。
Streams|對連接到父處理程序（通常是 Git）的標準輸入、輸出和錯誤流的抽象化。
Terminal|提供與附加終端機（如果存在）的互動。
SessionManager|提供有關目前使用者會話的資訊。
Trace|提供追蹤資訊，可能對偵錯實際環境中的問題很有用。機密資訊必須被完全過濾掉，或透過 `Write___Secret` 方法過濾。
FileSystem|對檔案系統操作的抽象化。
HttpClientFactory|用於建立 `HttpClient` 執行個體的工廠，這些執行個體已設定正確的使用者代理程式、標頭和代理伺服器設定。
Git|提供與 Git 和 Git 設定的互動。
Environment|對目前系統/使用者環境變數的抽象化。
SystemPrompts|提供用於顯示系統/作業系統原生憑證提示的服務。

## 錯誤處理與追蹤

GCM 對於不可恢復的錯誤採用「快速失敗」的方法。這通常
意味著擲出一個 `Exception`，它將傳播到進入點並被捕獲，
傳回一個非零的結束代碼，並列印出帶有
「fatal:」前綴的錯誤訊息。對於源自互通/原生程式碼的錯誤，您應該
擲出 `InteropException` 類型的例外。例外中的錯誤訊息
應為人類可讀。當存在已知或使用者可修復的問題時，
應提供如何自行解決問題的說明，或相關文件的連結。

當您想提醒使用者其設定中存在潛在問題，但該問題不一定會停止
操作/驗證時，可以透過標準錯誤流
(`ICommandContext.Streams.Error`) 發出警告。

`ITrace` 元件可以在 `ICommandContext` 物件上找到，或直接傳入某些建構函式。
在 GCM 的大多數地方，詳細和診斷資訊會被寫入追蹤物件。

[avalonia]: https://avaloniaui.net/
[core-program]: ../src/shared/Git-Credential-Manager/Program.cs
[credential-provider]: configuration.md#credentialprovider
[issue-113]: https://github.com/git-ecosystem/git-credential-manager/issues/113
[issue-136]: https://github.com/git-ecosystem/git-credential-manager/issues/136
[gcm-provider]: environment.md#GCM_PROVIDER
[msal]: https://github.com/AzureAD/microsoft-authentication-library-for-dotnet