// Jenkins 기동 시마다 실행되는 초기 설정 (init.groovy.d). 멱등.
// 읽는 파일 (jenkins:jenkins 600, /var/lib/jenkins/secrets/b102/):
//   admin-password          관리자 계정 비밀번호 (provision 이 생성)
//   webhook-secret          GitLab 웹훅 Secret token (provision 이 생성, GitLab 에 수동 등록)
//   gitlab-checkout-token   Project Access Token, Reporter + read_repository   (사람이 생성해서 넣음)
//   gitlab-status-token     Project Access Token, Developer + api (커밋 상태 기록) (사람이 생성해서 넣음)
//   gitlab-project-id       숫자 프로젝트 ID (apply-config.sh 가 API 로 조회해 기록)
import com.cloudbees.hudson.plugins.folder.computed.DefaultOrphanedItemStrategy
import com.cloudbees.hudson.plugins.folder.computed.PeriodicFolderTrigger
import com.cloudbees.plugins.credentials.CredentialsScope
import com.cloudbees.plugins.credentials.SystemCredentialsProvider
import com.cloudbees.plugins.credentials.domains.Domain
import com.cloudbees.plugins.credentials.impl.UsernamePasswordCredentialsImpl
import hudson.security.FullControlOnceLoggedInAuthorizationStrategy
import hudson.security.HudsonPrivateSecurityRealm
import hudson.slaves.EnvironmentVariablesNodeProperty
import hudson.util.Secret
import io.jenkins.plugins.gitlabbranchsource.BranchDiscoveryTrait
import io.jenkins.plugins.gitlabbranchsource.GitLabSCMSource
import io.jenkins.plugins.gitlabbranchsource.OriginMergeRequestDiscoveryTrait
import io.jenkins.plugins.gitlabserverconfig.credentials.PersonalAccessTokenImpl
import io.jenkins.plugins.gitlabserverconfig.servers.GitLabServer
import io.jenkins.plugins.gitlabserverconfig.servers.GitLabServers
import jenkins.branch.BranchSource
import jenkins.install.InstallState
import jenkins.model.Jenkins
import jenkins.model.JenkinsLocationConfiguration
import jenkins.scm.impl.trait.WildcardSCMHeadFilterTrait
import org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl
import org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject

def jenkins = Jenkins.get()
def secretsDir = new File(System.getenv('B102_SECRETS_DIR') ?: '/var/lib/jenkins/secrets/b102')
def readSecret = { String name, boolean required ->
    def f = new File(secretsDir, name)
    if (!f.isFile()) {
        if (required) throw new IllegalStateException("비밀 파일 없음: ${f}")
        return null
    }
    def v = f.getText('UTF-8').trim()
    if (!v) throw new IllegalStateException("비밀 파일이 비어 있음: ${f}")
    return v
}

// ---- 1. 보안: 로컬 계정 realm + 로그인한 사용자만 접근 (익명 읽기 불가) ----
def adminPassword = readSecret('admin-password', true)
def realm = jenkins.getSecurityRealm()
if (!(realm instanceof HudsonPrivateSecurityRealm)) {
    realm = new HudsonPrivateSecurityRealm(false)   // 회원가입 비허용
    jenkins.setSecurityRealm(realm)
}
def admin = realm.getUser('admin')
if (admin == null) {
    realm.createAccount('admin', adminPassword)
} else {
    admin.addProperty(HudsonPrivateSecurityRealm.Details.fromPlainPassword(adminPassword))
}
def strategy = new FullControlOnceLoggedInAuthorizationStrategy()
strategy.setAllowAnonymousRead(false)
jenkins.setAuthorizationStrategy(strategy)

// ---- 2. 크리덴셜 ----
def checkoutCredentialId = 'b102-gitlab-checkout'
def statusCredentialId   = 'b102-gitlab-status'
def webhookCredentialId  = 'b102-gitlab-webhook-secret'
def store = SystemCredentialsProvider.getInstance().getStore()
def domain = Domain.global()
def upsert = { credential ->
    def existing = store.getCredentials(domain).find { it.id == credential.id }
    if (existing == null) { store.addCredentials(domain, credential) } else { store.updateCredentials(domain, existing, credential) }
}
def hasCredential = { String id -> store.getCredentials(domain).any { it.id == id } }

def checkoutToken = readSecret('gitlab-checkout-token', false)
if (checkoutToken) {
    upsert(new UsernamePasswordCredentialsImpl(CredentialsScope.GLOBAL, checkoutCredentialId,
        'GitLab HTTPS checkout (Project Access Token, read_repository)', 'b102-jenkins-checkout', checkoutToken))
} else if (!hasCredential(checkoutCredentialId)) {
    throw new IllegalStateException("gitlab-checkout-token 파일이 없고 크리덴셜도 없음")
}

def statusToken = readSecret('gitlab-status-token', false)
if (statusToken) {
    def c = new PersonalAccessTokenImpl(CredentialsScope.SYSTEM, statusCredentialId,
        'GitLab API (Project Access Token, api) — 커밋 상태 기록')
    c.setToken(statusToken)
    upsert(c)
} else if (!hasCredential(statusCredentialId)) {
    throw new IllegalStateException("gitlab-status-token 파일이 없고 크리덴셜도 없음")
}

def webhookSecret = readSecret('webhook-secret', true)
upsert(new StringCredentialsImpl(CredentialsScope.SYSTEM, webhookCredentialId,
    'GitLab webhook secret token', Secret.fromString(webhookSecret)))

// ---- 3. GitLab 서버: 웹훅은 GitLab UI 에서 수동 등록. Jenkins 가 훅을 만들지 않는다 ----
def serverName = 'ssafy-gitlab'
def server = new GitLabServer('https://lab.ssafy.com', serverName, statusCredentialId)
server.setManageWebHooks(false)
server.setManageSystemHooks(false)
server.setImmediateHookTrigger(false)
server.setHooksRootUrl('https://j15b102.p.ssafy.io/')     // 웹훅 수신 공개 주소. Jenkins 기본 URL 과 분리
server.setWebhookSecretCredentialsId(webhookCredentialId)
def servers = GitLabServers.get()
servers.setServers(servers.getServers().findAll { it.name != serverName } + server)
servers.save()

// ---- 4. 멀티브랜치 잡: dev 와 origin MR 만 ----
def jobName = 'b102'
def existing = jenkins.getItem(jobName)
if (existing != null && !(existing instanceof WorkflowMultiBranchProject)) {
    throw new IllegalStateException("'${jobName}' 이 다른 타입으로 존재")
}
def job = existing ?: jenkins.createProject(WorkflowMultiBranchProject, jobName)
job.setDescription('B102 모노레포 CI/CD. MR 결과는 GitLab 커밋 상태로 기록. dev 는 CD gate 가 열린 경우에만 배포.')

def source = new GitLabSCMSource(serverName, 's15-bigdata-recom-sub1', 's15-bigdata-recom-sub1/S15P21B102')
source.setId('b102-gitlab-source')
def projectId = readSecret('gitlab-project-id', false)
if (projectId) source.setProjectId(Long.parseLong(projectId))
source.setProjectName('S15P21B102')
source.setCredentialsId(checkoutCredentialId)
source.setTraits([
    new BranchDiscoveryTrait(3),                      // 모든 브랜치 발견 → 아래 필터로 dev 만
    new OriginMergeRequestDiscoveryTrait(1),          // origin MR 만. fork MR 은 발견하지 않음. 1 = 타깃과 머지한 상태로 빌드
    new WildcardSCMHeadFilterTrait('dev MR-*', ''),
])
job.setSourcesList([new BranchSource(source)])
job.getProjectFactory().setScriptPath('Jenkinsfile')
job.setOrphanedItemStrategy(new DefaultOrphanedItemStrategy(true, '7', '20'))
job.getTriggers().values().findAll { it instanceof PeriodicFolderTrigger }.each { job.removeTrigger(it) }  // 폴링 없음. 웹훅만
job.save()

// ---- 5. 전역 ----
def env = jenkins.getGlobalNodeProperties().get(EnvironmentVariablesNodeProperty)
if (env == null) { env = new EnvironmentVariablesNodeProperty(); jenkins.getGlobalNodeProperties().add(env) }
env.getEnvVars().put('B102_CI_CACHE_ROOT', '/var/lib/jenkins/.cache/b102')

jenkins.setNumExecutors(1)                 // 운영 컨테이너와 CPU·메모리·docker 소켓을 공유한다. 동시 빌드 금지
jenkins.setSlaveAgentPort(-1)              // 에이전트 없음
JenkinsLocationConfiguration.get().setUrl('http://localhost:8080/')   // UI 는 SSH 터널로만. 공개 도메인은 hooksRootUrl 에만
jenkins.setInstallState(InstallState.INITIAL_SETUP_COMPLETED)
jenkins.save()
println('B102_JENKINS_CONFIGURATION_COMPLETE')
