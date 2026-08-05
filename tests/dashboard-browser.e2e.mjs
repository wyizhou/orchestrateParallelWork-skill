import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createDashboardServer } from "../skills/orchestrate-parallel-work/scripts/dashboard-server.mjs";

const runDir = await mkdtemp(path.join(tmpdir(), "opw-browser-"));
const evidenceDir = await mkdtemp(path.join(tmpdir(), "opw-browser-evidence-"));

async function json(relative, value) {
  const target = path.join(runDir, relative);
  const temporary = `${target}.next`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, target);
}

async function fixture() {
  await Promise.all(["tasks", "artifacts", "artifact-payloads"].map((name) => mkdir(path.join(runDir, name), { recursive: true })));
  const nodes = [
    ["plan","work","coordinator","accepted"], ["research","work","researcher","accepted"],
    ["api","work","developer","running"], ["ui","work","developer","running"],
    ["integrate","integration","integrator","blocked"], ["validate","validation","validator","planned"],
  ].map(([node_id,node_type,agent_type_id,status]) => ({ node_id,node_type,agent_type_id,task_ref:node_id,input_ports:[],output_ports:[`${node_id}-out`],status }));
  const edges = [
    ["e1","plan","research","control",null], ["e2","research","api","data","research-report"], ["e3","research","ui","data","research-report"],
    ["e4","api","integrate","data","api-bundle"], ["e5","ui","integrate","data","ui-bundle"], ["e6","integrate","validate","control",null],
  ].map(([edge_id,from,to,kind,artifact_contract_ref]) => ({ edge_id,kind,from:{node_id:from,port:`${from}-out`},to:{node_id:to,port:`${to}-in`},...(artifact_contract_ref?{artifact_contract_ref}:{}) }));
  await json("graph-plan.json", { schema_version:"1.0",plan_id:"browser-plan",plan_version:1,status:"running",capacity:{hard_limit:15,runtime_limit:8,permission_limit:6,effective_capacity:6},nodes,edges,terminal_outputs:["final-bundle"],summary:{agent_role_count:6,node_count:6,edge_count:6,task_count:6,planned_artifact_count:3,estimated_peak_agents:4,execution_shape:"hybrid"} });
  await json("agent-types.json", { agent_types:["coordinator","researcher","developer","integrator","validator"].map((agent_type_id)=>({agent_type_id})) });
  for (const node of nodes) await json(`tasks/${node.node_id}.json`, { task_id:node.node_id,node_id:node.node_id,goal:{plan:"Compile objective",research:"Research runtime contracts",api:"Build snapshot API",ui:"Render dependency graph",integrate:"Integrate dashboard",validate:"Independent acceptance"}[node.node_id],agent_type_id:node.agent_type_id,feature_points:[{id:`fp-${node.node_id}`,expected_behavior:`${node.node_id} behaves as contracted`}],modules:[{name:node.node_id,paths:[`src/${node.node_id}`]}],authoritative_inputs:["goal-contract"],inputs:[],outputs:[{port:`${node.node_id}-out`,artifact_contract_ref:node.node_id==="api"?"api-bundle":node.node_id==="ui"?"ui-bundle":node.node_id==="integrate"?"final-bundle":"research-report"}],constraints:["Read-only dashboard"],owned_scopes:[`src/${node.node_id}`],forbidden_scopes:["unrelated"],allowed_external_effects:[],completion_criteria:["Contract delivered"],self_validation:{test_gate:{mode:"command",steps:["npm test"],pass_condition:"exit 0",evidence_contract_ref:`${node.node_id}-test`},lint_gate:{mode:"command",steps:["npm run lint"],pass_condition:"exit 0",evidence_contract_ref:`${node.node_id}-lint`}},acceptance:{},...(node.node_id==="validate"?{validation_brief:{validation_id:"validate-browser",feature_points:[{id:"fp-validate",expected_behavior:"validate behaves as contracted"}],modules:[{name:"validate",paths:["src/validate"]}],authoritative_input_refs:["goal-contract"],artifact_refs:["final-bundle"],verification_steps:["Run the declared suite"],boundary_checks:[{id:"BOUNDARY-1",category:"determinism",invariant:"Repeated rendering preserves the same facts",verification_steps:["Render twice and compare"]}]}}:{}) });
  const contracts = [
    ["research-report","report","intermediate","research",["api","ui"]], ["api-bundle","source_code","intermediate","api",["integrate"]], ["ui-bundle","source_code","delivery","ui",["integrate"]], ["final-bundle","source_code","delivery","integrate",["validate"]], ["research-test","check_result","evidence","research",[]], ["research-lint","check_result","evidence","research",[]],
  ].map(([artifact_contract_id,artifact_type,purpose,producer,consumers])=>({artifact_contract_id,artifact_type,schema_version:"1.0",purpose,producer:{node_id:producer,port:`${producer}-out`},consumers:consumers.map((node_id)=>({node_id,port:`${node_id}-in`})),delivery:{format:"json",path:`artifacts/${artifact_contract_id}.json`},acceptance_checks:["schema valid"],required:true}));
  await json("artifacts/catalog.json", { artifacts:contracts });
  await json("artifact-registry.json", { artifacts:[{artifact_id:"research-report-v1",artifact_contract_id:"research-report",artifact_version:1,status:"accepted",producer:{node_id:"research",node_run_id:"run-research-a1",attempt:1,agent_instance_id:"agent-research-1"},digest:`sha256:${"a".repeat(64)}`,created_at:"2026-08-05T09:01:00Z",accepted_at:"2026-08-05T09:02:00Z",validation_evidence_refs:["research-test"]}] });
  await json("artifact-payloads/research.json", { artifact_id:"research-report-v1",artifact_contract_id:"research-report",files:[{path:"artifacts/research-report.json"}] });
  const passed = [{gate:"test_gate",status:"passed",step:"npm test",exit_code:0,evidence_ref:"test-evidence"},{gate:"lint_gate",status:"passed",step:"npm run lint",exit_code:0,evidence_ref:"lint-evidence"}];
  await json("node-runs.json", { coordinator_agent_instance_id:"agent-coordinator-1",entries:[
    {node_run_id:"run-plan-a1",node_id:"plan",attempt:1,agent_instance_id:"agent-coordinator-1",agent_type_id:"coordinator",status:"accepted",input_artifacts:[],output_artifacts:[],self_checks:passed},
    {node_run_id:"run-research-a1",node_id:"research",attempt:1,agent_instance_id:"agent-research-1",agent_type_id:"researcher",status:"accepted",input_artifacts:[],output_artifacts:["research-report-v1"],self_checks:passed},
    {node_run_id:"run-api-a2",node_id:"api",attempt:2,agent_instance_id:"agent-developer-1",agent_type_id:"developer",status:"active",input_artifacts:[{artifact_id:"research-report-v1",artifact_version:1}],output_artifacts:[],self_checks:[passed[0]]},
    {node_run_id:"run-ui-a1",node_id:"ui",attempt:1,agent_instance_id:"agent-developer-2",agent_type_id:"developer",status:"active",input_artifacts:[{artifact_id:"research-report-v1",artifact_version:1}],output_artifacts:[],self_checks:[passed[1]]},
    {node_run_id:"run-integrate-a0",node_id:"integrate",attempt:0,agent_instance_id:"agent-integrator-1",agent_type_id:"integrator",status:"blocked",input_artifacts:[],output_artifacts:[],self_checks:[]},
  ] });
  await json("approval.json", { status:"approved",plan_id:"browser-plan",plan_version:1,plan_hash:`sha256:${"b".repeat(64)}`,approved_capacity:6,approved_external_effects:[],approved_validation_exceptions:[] });
  await json("run.json", { execution_run_id:"browser-run",platform_capacity:8,permission_capacity:6 });
  await json("state.json", { revision:1,phase:"running",updated_at:"2026-08-05T09:05:00Z",platform_capacity:8,permission_capacity:6 });
  await writeFile(path.join(runDir,"events.ndjson"),[
    {event_id:"evt-1",timestamp:"2026-08-05T09:00:00Z",revision:1,type:"approval",plan_id:"browser-plan",message:"Plan approved."},
    {event_id:"evt-2",timestamp:"2026-08-05T09:02:00Z",revision:1,type:"artifact",artifact_id:"research-report-v1",message:"Research report accepted."},
    {event_id:"evt-3",timestamp:"2026-08-05T09:05:00Z",revision:1,type:"node_status",node_id:"api",from_status:"ready",to_status:"active",message:"API node started."},
  ].map(JSON.stringify).join("\n")+"\n");
}

await fixture();
const dashboard = await createDashboardServer({ runDir, port:0, interval:25, finalizationGraceMs:3_000 });
const launchOptions = { headless:true };
if (process.env.OPW_USE_SPARTICUZ === "1") {
  const { default: sparticuzChromium } = await import("@sparticuz/chromium");
  launchOptions.executablePath = await sparticuzChromium.executablePath();
  launchOptions.args = sparticuzChromium.args;
}
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport:{ width:1440,height:1024 }, reducedMotion:"no-preference" });
const consoleErrors=[];
page.on("console",(message)=>{if(message.type()==="error")consoleErrors.push(message.text());});
page.on("pageerror",(error)=>consoleErrors.push(error.message));

async function layoutReport(label) {
  const report=await page.evaluate(()=>{
    const visible=(node)=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=="none"&&style.visibility!=="hidden"&&rect.width>0&&rect.height>0;};
    const rect=(selector)=>{const node=document.querySelector(selector);if(!node||!visible(node))return null;const box=node.getBoundingClientRect();return {left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width,height:box.height};};
    const viewport={width:innerWidth,height:innerHeight};
    const active=document.querySelector(".view.active");
    const toolbar=document.querySelector(".graph-toolbar");
    const toolbarChildren=toolbar?[...toolbar.children].filter(visible).map((node)=>{const box=node.getBoundingClientRect();return {text:node.textContent.trim(),left:box.left,top:box.top,right:box.right,bottom:box.bottom};}):[];
    const toolbarBox=toolbar?.getBoundingClientRect();
    return {
      viewport,
      documentOverflowX:document.documentElement.scrollWidth-innerWidth,
      documentOverflowY:document.documentElement.scrollHeight-innerHeight,
      navOverflow:document.querySelector("#primary-nav").scrollWidth-document.querySelector("#primary-nav").clientWidth,
      activeView:active?.id,
      activeRect:rect(".view.active"),
      mainRect:rect(".main"),
      topbarRect:rect(".topbar"),
      sidebarRect:rect(".sidebar"),
      toolbarRect:toolbarBox?{top:toolbarBox.top,bottom:toolbarBox.bottom,height:toolbarBox.height,scrollHeight:toolbar.scrollHeight}:null,
      toolbarEscapes:toolbarBox?toolbarChildren.filter((item)=>item.top<toolbarBox.top-1||item.bottom>toolbarBox.bottom+1).map((item)=>item.text):[],
      visibleDialogs:[...document.querySelectorAll('[role="dialog"],.inspector.open')].filter(visible).map((node)=>{const box=node.getBoundingClientRect();return {id:node.id,left:box.left,top:box.top,right:box.right,bottom:box.bottom};}),
    };
  });
  assert.ok(report.documentOverflowX<=1,`${label}: document horizontal overflow ${JSON.stringify(report)}`);
  assert.ok(report.documentOverflowY<=1,`${label}: document vertical overflow ${JSON.stringify(report)}`);
  assert.ok(report.activeRect&&report.mainRect,`${label}: active view or main is not visible ${JSON.stringify(report)}`);
  assert.ok(Math.abs(report.activeRect.left-report.mainRect.left)<=1&&Math.abs(report.activeRect.right-report.mainRect.right)<=1,`${label}: active view is horizontally offset ${JSON.stringify(report)}`);
  if(report.viewport.width<=1023)assert.ok(report.navOverflow<=1,`${label}: primary navigation requires horizontal scrolling ${JSON.stringify(report)}`);
  if(report.activeView==="view-graph")assert.deepEqual(report.toolbarEscapes,[],`${label}: graph toolbar controls escape their row ${JSON.stringify(report)}`);
  for(const dialog of report.visibleDialogs){assert.ok(dialog.left>=-1&&dialog.top>=-1&&dialog.right<=report.viewport.width+1&&dialog.bottom<=report.viewport.height+1,`${label}: inspector or drawer escapes viewport ${JSON.stringify(report)}`);}
  return report;
}

async function waitForPanelSettled(selector) {
  await page.waitForFunction((target)=>{
    const node=document.querySelector(target);
    if(!node)return false;
    const box=node.getBoundingClientRect();
    return box.left>=-1&&box.top>=-1&&box.right<=innerWidth+1&&box.bottom<=innerHeight+1;
  },selector);
}

try {
  await page.goto(dashboard.url,{waitUntil:"networkidle"});
  assert.equal(await page.evaluate(async()=>{await document.fonts.ready;return document.fonts.check('14px "OPW Noto Sans SC"');}),true);
  await page.locator("#connection").filter({hasText:"实时"}).waitFor();
  await page.locator('[data-view="graph"]').waitFor();
  assert.equal(await page.locator(".node").count(),6);
  assert.equal(await page.locator(".edge-label").count(),6);
  await page.getByText("Artifacts 已接受 · 交付 / 证据",{exact:true}).waitFor();
  assert.match(await page.locator("#summary").textContent(),/1 \/ 0/);
  assert.match(await page.locator(".node.active,.node.running").first().evaluate((node)=>getComputedStyle(node).animationName),/nodePulse/);
  await page.emulateMedia({reducedMotion:"reduce"});
  assert.equal(await page.locator(".node.active,.node.running").first().evaluate((node)=>getComputedStyle(node).animationName),"none");
  await page.emulateMedia({reducedMotion:"no-preference"});

  await page.locator('.node[data-node-id="api"]').click();
  await page.locator("#inspector-title").filter({hasText:"Build snapshot API"}).waitFor();
  await page.locator("#clear-selection").click();
  await page.locator('.node[data-node-id="validate"]').click();
  await page.locator("#inspector-body").filter({hasText:"BOUNDARY-1"}).waitFor();
  await page.getByRole("button",{name:/任务/}).click();
  await page.getByLabel("搜索任务").fill("no-such-task");
  await page.getByText("当前条件下没有匹配的 Task。").waitFor();
  await page.getByLabel("搜索任务").fill("");
  await page.locator("#task-table tbody tr[data-id]").first().click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:/产物/}).click();
  assert.match(await page.locator("#artifact-summary").textContent(),/4交付契约2证据契约/);
  await page.locator(".version").first().click();
  await page.getByText("Artifact 检查器",{exact:true}).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:/运行 \/ Agent/}).click();
  await page.getByLabel("搜索运行记录").fill("agent-developer-1");
  assert.equal(await page.locator("#run-table tbody tr[data-id]").count(),1);
  await page.getByLabel("搜索运行记录").fill("");
  await page.locator("#run-table tbody tr[data-id]").first().click();
  await page.getByText("Node Run 检查器",{exact:true}).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:/事件/}).click();
  assert.equal(await page.locator(".event").count(),3);

  const viewports=[
    [1920,1080],[1440,1024],[1280,900],[1279,900],[1024,768],[1023,768],
    [768,768],[767,768],[560,720],[430,720],[429,720],[390,844],[320,568],
  ];
  const views=["graph","tasks","artifacts","runs","events"];
  for(const [width,height] of viewports){
    await page.setViewportSize({width,height});
    for(const view of views){
      await page.locator(`[data-view="${view}"]`).click();
      await layoutReport(`${width}x${height}/${view}`);
      if(width===1280||width===390)await page.screenshot({path:path.join(evidenceDir,`${width}-${view}.png`),fullPage:true});
    }
    if([1920,1280,1024,768,430,320].includes(width))await page.screenshot({path:path.join(evidenceDir,`matrix-${width}.png`),fullPage:true});
  }

  await page.setViewportSize({width:320,height:568});
  await page.locator('[data-view="graph"]').click();
  await page.locator("#zoom-in").click();
  await page.locator("#zoom-value").filter({hasText:"110%"}).waitFor();
  await page.locator("#fit-view").click();
  await page.locator("#recenter").click();
  await page.locator("#edge-select").selectOption({index:1});
  await page.locator("#inspector-kind").filter({hasText:"Edge"}).waitFor();
  await waitForPanelSettled("#graph-inspector");
  await layoutReport("320x568/mobile-edge-inspector");
  await page.locator("#clear-selection").click();
  await page.locator('.node[data-node-id="api"]').click();
  await waitForPanelSettled("#graph-inspector");
  await layoutReport("320x568/mobile-node-inspector");
  await page.locator("#clear-selection").click();
  await page.locator('[data-view="tasks"]').click();
  await page.locator("#task-table tbody tr[data-id]").first().click();
  await waitForPanelSettled("#detail-drawer");
  await layoutReport("320x568/mobile-task-drawer");
  await page.keyboard.press("Escape");
  await page.locator('[data-view="artifacts"]').click();
  await page.locator(".version").first().click();
  await waitForPanelSettled("#detail-drawer");
  await layoutReport("320x568/mobile-artifact-drawer");
  await page.keyboard.press("Escape");
  await page.locator('[data-view="runs"]').click();
  await page.locator("#run-table tbody tr[data-id]").first().click();
  await waitForPanelSettled("#detail-drawer");
  await layoutReport("320x568/mobile-run-drawer");
  await page.keyboard.press("Escape");

  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-view="events"]').click();
  await page.screenshot({path:path.join(evidenceDir,"mobile-events.png"),fullPage:true});
  await page.setViewportSize({width:1440,height:1024});
  await page.locator('[data-view="graph"]').click();
  await page.screenshot({path:path.join(evidenceDir,"desktop-graph.png"),fullPage:true});

  await writeFile(path.join(runDir,"state.json"),"{");
  await page.locator("#connection").filter({hasText:"已降级"}).waitFor({timeout:2_000});
  await page.getByText(/当前显示最后一个有效修订 r1/).waitFor();
  await json("state.json",{revision:2,phase:"running",updated_at:"2026-08-05T09:06:00Z",platform_capacity:8,permission_capacity:6});
  await page.locator("#revision-value").filter({hasText:"r2"}).waitFor({timeout:2_000});
  await page.locator("#connection").filter({hasText:"实时"}).waitFor();

  const finalChecks=[{gate:"test_gate",status:"passed",step:"npm test",exit_code:0,evidence_ref:"final-test"},{gate:"lint_gate",status:"passed",step:"npm run lint",exit_code:0,evidence_ref:"final-lint"}];
  await json("node-runs.json",{coordinator_agent_instance_id:"agent-coordinator-1",entries:[
    ["plan","coordinator","accepted",1],["research","researcher","accepted",1],["api","developer","accepted",2],["ui","developer","accepted",1],["integrate","integrator","integrated",1],["validate","validator","accepted",1],
  ].map(([node_id,agent_type_id,status,attempt])=>({node_run_id:`run-${node_id}-a${attempt}`,node_id,attempt,agent_instance_id:`agent-${agent_type_id}-1`,agent_type_id,status,input_artifacts:[],output_artifacts:[],self_checks:finalChecks,validator_status:"accepted",ended_at:"2026-08-05T09:07:00Z"}))});
  await json("artifact-registry.json",{artifacts:["research-report","api-bundle","ui-bundle","final-bundle"].map((artifact_contract_id,index)=>({artifact_id:`${artifact_contract_id}-v1`,artifact_contract_id,artifact_version:1,status:"accepted",producer:{node_id:["research","api","ui","integrate"][index],node_run_id:`run-${["research","api","ui","integrate"][index]}-a1`,attempt:1,agent_instance_id:"agent-final-1"},digest:`sha256:${String(index+1).repeat(64)}`,created_at:"2026-08-05T09:06:30Z",accepted_at:"2026-08-05T09:07:00Z",validation_evidence_refs:["final-validation"]}))});
  await json("state.json",{revision:3,phase:"completed",updated_at:"2026-08-05T09:07:00Z",platform_capacity:8,permission_capacity:6});
  await page.locator("#connection").filter({hasText:/运行已完成 · 服务已停止/}).waitFor({timeout:4_000});
  assert.equal(await page.locator(".node").count(),6);
  await page.screenshot({path:path.join(evidenceDir,"final-server-stopped.png"),fullPage:true});
  assert.deepEqual(consoleErrors,[]);
  process.stdout.write(`Browser verification passed. Evidence: ${evidenceDir}\n`);
} catch (error) {
  process.stderr.write(`Browser console errors: ${JSON.stringify(consoleErrors)}\n`);
  await page.screenshot({path:path.join(evidenceDir,"failure.png"),fullPage:true}).catch(()=>{});
  process.stderr.write(`Failure evidence: ${evidenceDir}\n`);
  throw error;
} finally {
  await browser.close();
  await dashboard.close();
  await rm(runDir,{recursive:true,force:true});
}
