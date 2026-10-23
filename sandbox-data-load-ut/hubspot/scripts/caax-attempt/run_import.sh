# usage: run_import.sh <csv> <request.json>
t=$(python -c "print(open(r'C:/Users/Utkarsh/.hubspot/token.txt',encoding='utf-8-sig').read().strip())")
export HUBSPOT_ACCESS_TOKEN="$t"
id=$(hubspot imports start --file "$1" --request "$2" 2>/dev/null | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "import id $id"
while :; do
  st=$(hubspot imports get "$id" 2>/dev/null | python -c "import sys,json;d=json.load(sys.stdin);d=d.get('data',d);print(d['state'],json.dumps(d['metadata']['counters']))")
  case "$st" in PROCESSING*|STARTED*|DEFERRED*) sleep 15;; *) echo "$st"; break;; esac
done
hubspot imports errors "$id" 2>/dev/null > "errors_$id.jsonl"; echo "errors file lines: $(wc -l < errors_$id.jsonl)"
