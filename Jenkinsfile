// B102 CI. 트리거: GitLab 웹훅 (MR-* 와 dev). executor 1개.
// 3단계: CI 만. 배포(CD) 는 4단계에서 dev + gate 조건으로 추가한다.
// 컴포넌트 선택은 scripts/ci/changed_components.py, 실제 검증은 scripts/ci/run-*-ci.sh (고정 버전 docker 이미지 안에서 실행).
pipeline {
    agent none

    options {
        skipDefaultCheckout(true)
        buildDiscarder(logRotator(numToKeepStr: '30'))
        disableConcurrentBuilds()
    }

    parameters {
        booleanParam(
            name: 'FORCE_ALL',
            defaultValue: false,
            description: '변경 범위와 관계없이 frontend·backend·data·deploy 검증을 모두 실행한다.'
        )
    }

    stages {
        // executor 를 잡기 전에 통과시킨다. 같은 MR 의 이전 build 만 중단된다. 다른 MR·dev 에는 영향 없음.
        stage('MR 최신 빌드 우선') {
            when { expression { env.BRANCH_NAME?.startsWith('MR-') } }
            steps {
                milestone(ordinal: currentBuild.number, label: "${env.BRANCH_NAME} #${currentBuild.number}")
            }
        }

        stage('CI') {
            agent any

            stages {
                stage('Checkout') {
                    options { timeout(time: 10, unit: 'MINUTES') }
                    steps {
                        script {
                            def checkoutState = checkout scm
                            env.CI_SHA = checkoutState.GIT_COMMIT ?: sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
                            env.CI_SUPERSEDED = 'false'
                            sh 'test -n "$CI_SHA" && git cat-file -e "$CI_SHA^{commit}"'

                            // executor 가 1개라 dev build 가 밀린다. 더 새 dev 가 있으면 이 build 는 조용히 끝낸다.
                            if (env.BRANCH_NAME == 'dev') {
                                def latestSha = sh(script: 'git rev-parse refs/remotes/origin/dev', returnStdout: true).trim()
                                if (latestSha != env.CI_SHA) {
                                    env.CI_SUPERSEDED = 'true'
                                    currentBuild.description = "stale-dev ${env.CI_SHA.take(8)}"
                                    echo "더 최신 dev ${latestSha.take(8)} 가 있어 ${env.CI_SHA.take(8)} 의 CI 를 건너뜁니다."
                                }
                            }
                        }
                    }
                }

                stage('변경 범위 계산') {
                    when { expression { env.CI_SUPERSEDED != 'true' } }
                    options { timeout(time: 5, unit: 'MINUTES') }
                    steps {
                        script {
                            // 선택기 자체 테스트 (호스트 python3, 표준 라이브러리만)
                            sh 'python3 -m unittest discover -s scripts/ci/tests -p "test_*.py"'

                            def forceArgument = params.FORCE_ALL ? ' --all' : ''
                            sh "python3 scripts/ci/changed_components.py --jenkins${forceArgument} > ci-plan.json"

                            // readJSON 은 Pipeline Utility Steps plugin 이 필요하다. plugin 을 늘리지 않으려고 python 으로 읽는다.
                            def planValue = { String key ->
                                sh(
                                    script: "python3 -c \"import json; v=json.load(open('ci-plan.json', encoding='utf-8'))['${key}']; print(str(v).lower() if isinstance(v, bool) else (v or ''))\"",
                                    returnStdout: true
                                ).trim()
                            }
                            env.CI_FRONTEND = planValue('frontend')
                            env.CI_BACKEND = planValue('backend')
                            env.CI_DATA = planValue('data')
                            env.CI_DEPLOY = planValue('deploy')

                            def selected = ['frontend', 'backend', 'data', 'deploy'].findAll { env."CI_${it.toUpperCase()}" == 'true' }
                            currentBuild.description = selected ? selected.join(', ') : 'docs-only'
                            echo "CI 실행 계획: ${readFile(file: 'ci-plan.json', encoding: 'UTF-8').trim()}"
                        }
                    }
                }

                stage('컴포넌트 CI') {
                    when { expression { env.CI_SUPERSEDED != 'true' } }
                    options { timeout(time: 40, unit: 'MINUTES') }
                    failFast false
                    // 같은 서버에서 운영 컨테이너와 메모리를 나눠 쓴다. 병렬은 frontend·data·deploy 처럼 가벼운 것만,
                    // backend(PG+ES+gradle) 는 병렬 블록 뒤에 단독으로 돈다.
                    parallel {
                        stage('frontend') {
                            when { expression { env.CI_FRONTEND == 'true' } }
                            steps { sh 'bash scripts/ci/run-frontend-ci.sh' }
                        }
                        stage('data') {
                            when { expression { env.CI_DATA == 'true' } }
                            steps { sh 'bash scripts/ci/run-data-ci.sh' }
                        }
                        stage('deploy') {
                            when { expression { env.CI_DEPLOY == 'true' } }
                            steps { sh 'bash scripts/ci/run-deploy-ci.sh' }
                        }
                    }
                }

                stage('backend') {
                    when { expression { env.CI_SUPERSEDED != 'true' && env.CI_BACKEND == 'true' } }
                    options { timeout(time: 40, unit: 'MINUTES') }
                    steps { sh 'bash scripts/ci/run-backend-ci.sh' }
                }

                // 4단계: 얇은 CD. dev 에서 CI 가 전부 통과했고, 운영 스위치(/etc/b102/cd-enabled)가 있을 때만
                // 이 workspace 의 SHA 로 이미지를 빌드해 deploy.sh 를 호출한다. 서버 작업 트리의 git 은 건드리지 않는다.
                // deploy.sh 가 배포 전 pg_dump, 마이그레이션 지문 비교, 실패 시 조건부 자동 복구를 담당한다.
                stage('deploy (dev)') {
                    when {
                        allOf {
                            branch 'dev'
                            expression { env.CI_SUPERSEDED != 'true' }
                            expression { currentBuild.description != 'docs-only' }
                        }
                    }
                    options { timeout(time: 20, unit: 'MINUTES') }
                    steps {
                        script {
                            if (!fileExists('/etc/b102/cd-enabled')) {
                                echo 'CD gate 닫힘 (/etc/b102/cd-enabled 없음) → 배포 건너뜀. 켜려면: sudo touch /etc/b102/cd-enabled'
                                currentBuild.description = "${currentBuild.description} · cd-gate-closed"
                                return
                            }
                            // 배포 직전 최신 dev 재확인. 더 새 커밋이 있으면 이 커밋은 배포하지 않는다 (다음 build 가 한다)
                            // 평문 `git fetch` 는 Jenkins 크리덴셜이 없어 GitLab 인증에 실패한다(exit 128). checkout scm 이 인증된 fetch 로 refs 를 갱신한다.
                            checkout scm
                            def latestSha = sh(script: 'git rev-parse refs/remotes/origin/dev', returnStdout: true).trim()
                            if (latestSha != env.CI_SHA) {
                                echo "더 최신 dev ${latestSha.take(8)} 가 있어 ${env.CI_SHA.take(8)} 은 배포하지 않습니다."
                                currentBuild.description = "${currentBuild.description} · deploy-skipped-stale"
                                return
                            }
                            sh 'ENV_FILE=/etc/b102/deploy.env bash deploy/scripts/deploy.sh --no-pull'
                            currentBuild.description = "${currentBuild.description} · deployed ${env.CI_SHA.take(8)}"
                        }
                    }
                }
            }

            post {
                always {
                    junit(allowEmptyResults: true, testResults: 'backend/build/test-results/test/TEST-*.xml')
                    archiveArtifacts(allowEmptyArchive: true, artifacts: 'ci-plan.json')
                }
                cleanup {
                    // 워크스페이스는 다음 빌드가 재사용한다(캐시 효과). 빌드 산출물만 비운다.
                    sh 'rm -rf frontend/dist frontend/node_modules backend/build || true'
                }
            }
        }
    }
}
