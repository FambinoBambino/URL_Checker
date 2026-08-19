# URL_Checker
This addon allows users to check URLs / sites using VirusTotal. 

**Important:** URLs submitted through this extension are sent to VirusTotal and are subject to VirusTotal's policies. Do not submit sensitive or confidential URLs.

Features range from being able to copy and paste into the single-use 'URL Check' tab to storing links within a folder, so that you can easily re-scan common links as often as you need and with ease of location and information. You also have the ability to right-click a page / link and easily put it into a folder using the context menu, which has 2 modes. A VirusTotal API key is required, but can be acquired for free, visit https://docs.virustotal.com/docs/please-give-me-an-api-key for more information.

With the single-use 'URL Check' tab, it will store the results of the most recent scan and allow you to open the VirusTotal page corresponding to that link.
As for any links in a folder, they will also store recents scans and in addition to opening up their correspinding VT pages, you can click on the link itself to visit its page. Any links with a result of suspicious or malicious will need confirmation before opening their page.

If you have a lot of links, you can easily search for the link you're looking for in the search bar located at the top of the pop-up which directs you to the folder in which your desired link is located.

As for the scanning itself, if there is a cached report, the response will be quick. However, if it needs to be re-scanned, it can take quite a while, so the extension waits in 20-second intervals for a response. This interval happens a max of 10 times. If you close the pop-up or the pop-up is out of focus, you will receive OS-level notifications on the progress for each interval and the final result. If the pop-up is open while the scan is happening, then the notifications will appear in the form of toast messages, and these toast messages will re-appear even if you close and re-open the pop-up which lets you know it's still in the progress of scanning.

## DISCLAIMER ##
This extension is an independent, open-source project and is not affiliated with, endorsed by, or sponsored by VirusTotal.

When you submit a URL through this extension, the URL is submitted to VirusTotal using your own VirusTotal API key. Your use of VirusTotal's services is subject to VirusTotal's applicable terms and policies.

Please review VirusTotal's:
- [Terms of Service](https://cloud.google.com/terms)
- [Privacy Policy](https://cloud.google.com/terms/secops/privacy-notice)

URLs submitted through this extension are handled by VirusTotal according to its applicable terms and policies.

As VirusTotal states themselves on their website "By submitting data above, you are agreeing to our [Terms of Service](https://cloud.google.com/terms) and [Privacy Notice](https://cloud.google.com/terms/secops/privacy-notice), and to the sharing of your Sample submission with the security community. **Please do not submit any personal information; we are not responsible for the contents of your submission.** [Learn more](https://docs.virustotal.com/docs/how-it-works)."
