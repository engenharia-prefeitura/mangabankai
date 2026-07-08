<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/">
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <meta name="robots" content="noindex"/>
        <title>Sitemap — MangaBankai</title>
        <style>
          :root { --bg:#0d0d12; --card:#16161f; --border:#262633; --accent:#6c63ff; --text:#e8e8ef; --muted:#9a9ab0; }
          * { box-sizing: border-box; }
          body { margin:0; background:var(--bg); color:var(--text); font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; padding:32px 16px; }
          .wrap { max-width:980px; margin:0 auto; }
          h1 { font-size:1.5rem; margin:0 0 4px; }
          .sub { color:var(--muted); font-size:0.9rem; margin-bottom:24px; }
          .count { display:inline-block; background:var(--accent); color:#fff; font-size:0.8rem; font-weight:600; padding:3px 10px; border-radius:999px; margin-left:8px; }
          table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--border); border-radius:12px; overflow:hidden; }
          th, td { text-align:left; padding:11px 14px; font-size:0.88rem; border-bottom:1px solid var(--border); }
          th { background:rgba(255,255,255,0.03); color:var(--muted); font-weight:600; text-transform:uppercase; font-size:0.72rem; letter-spacing:0.05em; }
          tr:last-child td { border-bottom:none; }
          tr:hover td { background:rgba(108,99,255,0.06); }
          a { color:var(--accent); text-decoration:none; word-break:break-all; }
          a:hover { text-decoration:underline; }
          .foot { margin-top:20px; color:var(--muted); font-size:0.8rem; text-align:center; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <!-- ÍNDICE DE SITEMAPS -->
          <xsl:if test="s:sitemapindex">
            <h1>Índice de Sitemaps
              <span class="count"><xsl:value-of select="count(s:sitemapindex/s:sitemap)"/> sitemaps</span>
            </h1>
            <p class="sub">Este é um índice que aponta para os sitemaps com as páginas do site.</p>
            <table>
              <tr><th>Sitemap</th><th>Última modificação</th></tr>
              <xsl:for-each select="s:sitemapindex/s:sitemap">
                <tr>
                  <td><a href="{s:loc}"><xsl:value-of select="s:loc"/></a></td>
                  <td><xsl:value-of select="s:lastmod"/></td>
                </tr>
              </xsl:for-each>
            </table>
          </xsl:if>

          <!-- LISTA DE URLs -->
          <xsl:if test="s:urlset">
            <h1>Sitemap
              <span class="count"><xsl:value-of select="count(s:urlset/s:url)"/> URLs</span>
            </h1>
            <p class="sub">Páginas deste site enviadas aos mecanismos de busca.</p>
            <table>
              <tr><th>URL</th><th>Modificação</th><th>Freq.</th><th>Prior.</th></tr>
              <xsl:for-each select="s:urlset/s:url">
                <tr>
                  <td><a href="{s:loc}"><xsl:value-of select="s:loc"/></a></td>
                  <td><xsl:value-of select="s:lastmod"/></td>
                  <td><xsl:value-of select="s:changefreq"/></td>
                  <td><xsl:value-of select="s:priority"/></td>
                </tr>
              </xsl:for-each>
            </table>
          </xsl:if>

          <p class="foot">Gerado por MangaBankai</p>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
