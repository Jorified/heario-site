git push origin master
if ($LASTEXITCODE -eq 0) {
    vercel --prod --yes
}
